-- CivicPulse AI foundation hardening
-- Additive migration: preserves existing rows and deployed objects.
-- Reconcile the existing live migration history before applying to production.
-- This migration intentionally does not change Storage bucket visibility.

-- 1. Allow the already-deployed resolution route to append its terminal audit event.
alter table public.issue_events
  drop constraint if exists issue_events_event_type_check;
alter table public.issue_events
  add constraint issue_events_event_type_check
  check (event_type in (
    'created','merged','status_changed','assigned',
    'resolution_submitted','resolution_verified','resolved','commented',
    'reopened','escalated'
  ));

-- 2. Narrow direct Data API grants. All application writes continue through the Edge API
-- (service_role) except authenticated comments/votes and display_name updates.
revoke all on table public.profiles, public.civic_issues, public.issue_events,
  public.issue_comments, public.issue_votes, public.civic_api_rate_limits
  from anon, authenticated;

grant select on table public.civic_issues to anon;
grant select on table public.profiles, public.civic_issues, public.issue_events,
  public.issue_comments, public.issue_votes to authenticated;
grant update (display_name) on table public.profiles to authenticated;
grant insert on table public.issue_comments to authenticated;
grant insert, delete on table public.issue_votes to authenticated;
grant all on table public.profiles, public.civic_issues, public.issue_events,
  public.issue_comments, public.issue_votes, public.civic_api_rate_limits to service_role;

-- Rate limits remain entirely server-only.
revoke all on table public.civic_api_rate_limits from anon, authenticated;
grant all on table public.civic_api_rate_limits to service_role;

-- 3. Recreate least-privilege policies. Policies are permissive ORed; remove obsolete policies
-- that granted authenticated event inserts or unrestricted profile updates.
drop policy if exists "users may update own profile" on public.profiles;
drop policy if exists "profiles readable to signed-in users" on public.profiles;
drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "profiles_update_self_without_role_change" on public.profiles;
drop policy if exists "issue events readable by signed-in users" on public.issue_events;
drop policy if exists "events_read_authenticated" on public.issue_events;
drop policy if exists "issue event actor creates events" on public.issue_events;
drop policy if exists "staff may append issue events" on public.issue_events;
drop policy if exists "events_staff_append_self" on public.issue_events;
drop policy if exists "issue comments readable by signed-in users" on public.issue_comments;
drop policy if exists "comments_read_authenticated" on public.issue_comments;
drop policy if exists "users may add comments" on public.issue_comments;
drop policy if exists "comments_insert_self" on public.issue_comments;
drop policy if exists "votes readable to signed-in users" on public.issue_votes;
drop policy if exists "votes_read_authenticated" on public.issue_votes;
drop policy if exists "users may vote as themselves" on public.issue_votes;
drop policy if exists "votes_insert_self" on public.issue_votes;
drop policy if exists "users may remove own votes" on public.issue_votes;
drop policy if exists "votes_delete_self" on public.issue_votes;

create policy "profiles_select_authenticated"
on public.profiles for select to authenticated using (true);

create policy "profiles_update_display_name_self"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "events_select_authenticated"
on public.issue_events for select to authenticated using (true);

-- No direct issue_events INSERT grant/policy for authenticated clients. The Edge API writes
-- audited events with service_role only after authenticating and authorizing the actor.

create policy "comments_select_authenticated"
on public.issue_comments for select to authenticated using (true);

create policy "comments_insert_self"
on public.issue_comments for insert to authenticated
with check ((select auth.uid()) = author_id);

create policy "votes_select_authenticated"
on public.issue_votes for select to authenticated using (true);

create policy "votes_insert_self"
on public.issue_votes for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "votes_delete_self"
on public.issue_votes for delete to authenticated
using ((select auth.uid()) = user_id);

-- 4. Atomic staff resolution: status change and terminal audit event commit or roll back together.
-- Edge handler MUST call auth.getUser(access_token) and requireStaff before invoking this
-- service_role-only routine. The actor id is not accepted from request JSON.
create or replace function public.confirm_civic_issue_resolution(
  p_issue_id uuid,
  p_actor_id uuid,
  p_manual_override boolean default false,
  p_review_note text default null
)
returns public.civic_issues
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_role public.civic_user_role;
  v_issue public.civic_issues%rowtype;
  v_old_status public.civic_issue_status;
  v_verification jsonb;
  v_ai_passed boolean;
  v_note text;
begin
  select role into v_role from public.profiles where id = p_actor_id;
  if v_role is null or v_role not in ('staff','admin') then
    raise exception 'Staff or admin role required' using errcode = '42501';
  end if;

  select * into v_issue
    from public.civic_issues
   where id = p_issue_id
   for update;
  if not found then
    raise exception 'Issue not found' using errcode = 'P0002';
  end if;
  if v_issue.status = 'Resolved' then
    raise exception 'Issue is already resolved' using errcode = '23505';
  end if;
  if v_issue.after_image_path is null then
    raise exception 'After-repair evidence is required' using errcode = '23514';
  end if;

  v_old_status := v_issue.status;
  v_verification := coalesce(v_issue.ai_metadata->'resolution_verification','{}'::jsonb);
  v_ai_passed := coalesce(v_verification->>'status','') = 'success'
    and coalesce((v_verification->>'is_resolved')::boolean,false)
    and coalesce((v_verification->>'confidence')::numeric,0) >= 0.85;

  v_note := nullif(left(trim(coalesce(p_review_note,'')),500),'');
  if not v_ai_passed and (not coalesce(p_manual_override,false)
      or char_length(coalesce(v_note,'')) < 10) then
    raise exception 'AI verification did not pass; manual staff review with a note is required'
      using errcode = '23514';
  end if;

  update public.civic_issues
     set status = 'Resolved',
         resolved_at = now(),
         resolution_verified_at = case when v_ai_passed then now() else null end,
         assigned_to = p_actor_id
   where id = p_issue_id
   returning * into v_issue;

  insert into public.issue_events(
    issue_id,actor_id,event_type,old_status,new_status,note,metadata
  ) values (
    p_issue_id,p_actor_id,'resolved',
    v_old_status,
    'Resolved',
    coalesce(v_note,case when v_ai_passed then 'Staff confirmed AI-assisted repair evidence' else 'Staff manually confirmed repair' end),
    jsonb_build_object('ai_verified',v_ai_passed,'manual_override',not v_ai_passed,
      'confidence',v_verification->>'confidence')
  );

  return v_issue;
end;
$$;

revoke all on function public.confirm_civic_issue_resolution(uuid,uuid,boolean,text)
  from public, anon, authenticated;
grant execute on function public.confirm_civic_issue_resolution(uuid,uuid,boolean,text)
  to service_role;

-- 5. Explicit grants for Data API roles are intentionally narrow. Newly created public-schema
-- tables on current Supabase projects may not receive default grants; add grants alongside
-- future table creation and RLS policies.

-- 6. Atomic staff status transition and audit append.
create or replace function public.transition_civic_issue_status(
  p_issue_id uuid,
  p_actor_id uuid,
  p_next_status public.civic_issue_status
)
returns public.civic_issues
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_role public.civic_user_role;
  v_issue public.civic_issues%rowtype;
  v_previous public.civic_issue_status;
  v_event text;
begin
  select role into v_role from public.profiles where id=p_actor_id;
  if v_role is null or v_role not in ('staff','admin') then
    raise exception 'Staff or admin role required' using errcode='42501';
  end if;

  select * into v_issue from public.civic_issues where id=p_issue_id for update;
  if not found then raise exception 'Issue not found' using errcode='P0002'; end if;

  v_previous := v_issue.status;
  if p_next_status is null then
    raise exception 'Next status is required' using errcode='22023';
  end if;
  if p_next_status = 'Resolved' then
    raise exception 'Use the resolution confirmation workflow' using errcode='23514';
  end if;
  if v_previous = 'Resolved' then
    raise exception 'Resolved issues cannot be reopened through this endpoint' using errcode='23514';
  end if;
  if not (
    (v_previous='Pending' and p_next_status='Assigned')
    or (v_previous='Assigned' and p_next_status='In Progress')
    or (v_previous='In Progress' and p_next_status='Assigned')
    or (v_previous=p_next_status)
  ) then
    raise exception 'Invalid issue status transition' using errcode='23514';
  end if;

  update public.civic_issues
     set status=p_next_status,
         assigned_to=case when p_next_status='Assigned' then p_actor_id else assigned_to end
   where id=p_issue_id returning * into v_issue;

  v_event := case when p_next_status='Assigned' then 'assigned' else 'status_changed' end;
  insert into public.issue_events(issue_id,actor_id,event_type,old_status,new_status,note)
  values(p_issue_id,p_actor_id,v_event,v_previous,p_next_status,'Workflow updated by staff');

  return v_issue;
end;
$$;

revoke all on function public.transition_civic_issue_status(uuid,uuid,public.civic_issue_status)
  from public,anon,authenticated;
grant execute on function public.transition_civic_issue_status(uuid,uuid,public.civic_issue_status)
  to service_role;
