-- CivicPulse AI — transactional database routine design
-- Date: 2026-10-30
-- DESIGN ONLY. Do not execute against production without migration reconciliation,
-- peer review, test data and a rollback strategy.
--
-- These routines complement docs/04-database-sql-design.sql.
-- The current edge handler uses a service-role client; only server-side code may call these
-- SECURITY INVOKER routines. Every call must be preceded by bearer validation and role checks.

-- =============================================================================
-- 1. Atomic report intake and 15 m deduplication
-- =============================================================================
-- The category-scoped advisory lock closes the no-row-to-lock race for the MVP.
-- It serializes submissions of the same category; replace with bucket/neighbor-cell locking
-- after representative throughput tests.

create or replace function public.submit_civic_issue(
  p_reporter_id uuid,
  p_defect_type text,
  p_description text,
  p_lat double precision,
  p_lng double precision,
  p_landmark text default '',
  p_zone text default 'unassigned',
  p_priority_score smallint default 0,
  p_severity public.civic_issue_severity default 'LOW',
  p_confidence numeric default 0,
  p_before_damage_pct numeric default 0,
  p_before_image_path text default null,
  p_ai_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  point_value extensions.geography;
  matched public.civic_issues%rowtype;
  merged boolean := false;
begin
  if p_defect_type not in ('pothole','garbage','sewage','streetlight','unknown') then
    raise exception 'Unsupported issue category' using errcode = '22023';
  end if;

  if char_length(trim(coalesce(p_description,''))) not between 5 and 2000 then
    raise exception 'Description must be between 5 and 2000 characters' using errcode = '22023';
  end if;

  if p_lat is null or p_lat < -90 or p_lat > 90
     or p_lng is null or p_lng < -180 or p_lng > 180 then
    raise exception 'Invalid coordinates' using errcode = '22023';
  end if;

  point_value := extensions.st_setsrid(
    extensions.st_makepoint(p_lng,p_lat),4326
  )::extensions.geography;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('civic-dedupe:' || p_defect_type,0)
  );

  select *
    into matched
    from public.civic_issues i
   where i.status <> 'Resolved'
     and i.defect_type = p_defect_type
     and extensions.st_dwithin(i.location,point_value,15)
   order by extensions.st_distance(i.location,point_value)
   limit 1
   for update;

  if matched.id is not null then
    update public.civic_issues
       set report_frequency = report_frequency + 1,
           duplicate_count = duplicate_count + 1
     where id = matched.id
     returning * into matched;

    merged := true;

    insert into public.issue_events(
      issue_id,actor_id,event_type,note,metadata
    )
    values (
      matched.id,p_reporter_id,'merged',
      'Nearby report merged into this incident',
      jsonb_build_object('source','public_api','merge_radius_m',15)
    );
  else
    insert into public.civic_issues(
      reporter_id,defect_type,description,priority_score,severity,
      location,zone,confidence,upvote_count,report_frequency,duplicate_count,
      before_damage_pct,before_image_path,ai_metadata,landmark
    )
    values (
      p_reporter_id,p_defect_type,trim(p_description),
      greatest(0,least(100,coalesce(p_priority_score,0))),
      coalesce(p_severity,'LOW'),
      point_value,
      left(coalesce(nullif(trim(p_zone),''),'unassigned'),80),
      greatest(0,least(1,coalesce(p_confidence,0))),
      0,1,0,
      greatest(0,least(100,coalesce(p_before_damage_pct,0))),
      p_before_image_path,
      coalesce(p_ai_metadata,'{}'::jsonb),
      left(coalesce(p_landmark,''),200)
    )
    returning * into matched;

    insert into public.issue_events(
      issue_id,actor_id,event_type,new_status,note,metadata
    )
    values (
      matched.id,p_reporter_id,'created',matched.status,'Issue reported',
      jsonb_build_object('source','public_api')
    );
  end if;

  return jsonb_build_object(
    'merged',merged,
    'ticket',
      (to_jsonb(matched)-'location')
      || jsonb_build_object(
        'location',extensions.st_asgeojson(matched.location)::jsonb
      )
  );
end;
$$;

revoke all on function public.submit_civic_issue(
  uuid,text,text,double precision,double precision,text,text,smallint,
  public.civic_issue_severity,numeric,numeric,text,jsonb
) from public,anon,authenticated;

grant execute on function public.submit_civic_issue(
  uuid,text,text,double precision,double precision,text,text,smallint,
  public.civic_issue_severity,numeric,numeric,text,jsonb
) to service_role;

-- =============================================================================
-- 2. Fixed-window rate-limit counter
-- =============================================================================
-- Hash the upstream-resolved identity before passing the bucket key. Do not trust arbitrary
-- X-Forwarded-For input from the browser. Expire stale rows using a scheduled maintenance task.

create or replace function public.consume_civic_report_limit(
  p_bucket_key text,
  p_limit integer default 5,
  p_window_seconds integer default 3600
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_count integer;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate-limit configuration' using errcode = '22023';
  end if;

  insert into public.civic_api_rate_limits(
    bucket_key,window_started_at,request_count
  )
  values (p_bucket_key,now(),1)
  on conflict (bucket_key) do update
    set window_started_at = case
          when public.civic_api_rate_limits.window_started_at
               + pg_catalog.make_interval(secs => p_window_seconds) <= now()
          then now()
          else public.civic_api_rate_limits.window_started_at
        end,
        request_count = case
          when public.civic_api_rate_limits.window_started_at
               + pg_catalog.make_interval(secs => p_window_seconds) <= now()
          then 1
          else public.civic_api_rate_limits.request_count + 1
        end
  returning request_count into current_count;

  return current_count <= p_limit;
end;
$$;

revoke all on function public.consume_civic_report_limit(text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.consume_civic_report_limit(text,integer,integer)
  to service_role;

-- =============================================================================
-- 3. Atomic vote counter trigger
-- =============================================================================
-- Assumes upvote_count means explicit votes only, not report submissions.
-- Before enabling this trigger, reconcile old data and update duplicate-merge semantics.

create or replace function public.refresh_issue_vote_count()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.civic_issues
       set upvote_count = upvote_count + 1
     where id = new.issue_id;
    return new;
  else
    update public.civic_issues
       set upvote_count = greatest(0,upvote_count - 1)
     where id = old.issue_id;
    return old;
  end if;
end;
$$;

-- Fresh-schema setup only; inspect current trigger catalogue before creating it.
-- create trigger issue_votes_refresh_count
-- after insert or delete on public.issue_votes
-- for each row execute function public.refresh_issue_vote_count();

-- =============================================================================
-- 4. Atomic resolution transition and audit append
-- =============================================================================
-- Edge route must validate the caller JWT and staff/admin role before passing actor_id.
-- The routine independently checks the actor's database role and evidence prerequisite.
-- AI passing threshold is currently 0.85 per Edge source; keep configurable after product approval.

create or replace function public.confirm_civic_issue_resolution(
  p_issue_id uuid,
  p_actor_id uuid,
  p_note text default null,
  p_manual_override boolean default false,
  p_verification_confidence numeric default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_role public.civic_user_role;
  previous_status public.civic_issue_status;
  updated_issue public.civic_issues%rowtype;
begin
  select role into actor_role
    from public.profiles
   where id = p_actor_id;

  if actor_role not in ('staff','admin') then
    raise exception 'Staff role required' using errcode = '42501';
  end if;

  select status into previous_status
    from public.civic_issues
   where id = p_issue_id
   for update;

  if not found then
    raise exception 'Issue not found' using errcode = 'P0002';
  end if;

  if previous_status = 'Resolved' then
    raise exception 'Issue is already resolved' using errcode = '23505';
  end if;

  if not exists (
    select 1 from public.civic_issues
     where id = p_issue_id and after_image_path is not null
  ) then
    raise exception 'After-repair evidence is required' using errcode = '23514';
  end if;

  if p_manual_override then
    if char_length(trim(coalesce(p_note,''))) < 10 then
      raise exception 'Manual override requires a review note of at least 10 characters'
        using errcode = '22023';
    end if;
  elsif p_verification_confidence is null
     or p_verification_confidence < 0.85
     or p_verification_confidence > 1 then
    raise exception 'AI verification did not meet the confirmation threshold'
      using errcode = '23514';
  end if;

  update public.civic_issues
     set status = 'Resolved',
         resolved_at = now(),
         resolution_verified_at = case
           when p_manual_override then null else now()
         end
   where id = p_issue_id
   returning * into updated_issue;

  insert into public.issue_events(
    issue_id,actor_id,event_type,old_status,new_status,note,metadata
  )
  values (
    p_issue_id,p_actor_id,'resolved',previous_status,'Resolved',
    nullif(trim(coalesce(p_note,'')),''),
    jsonb_build_object(
      'manual_override',p_manual_override,
      'verification_confidence',p_verification_confidence
    )
  );

  return jsonb_build_object(
    'issue_id',updated_issue.id,
    'status',updated_issue.status,
    'resolved_at',updated_issue.resolved_at
  );
end;
$$;

revoke all on function public.confirm_civic_issue_resolution(
  uuid,uuid,text,boolean,numeric
) from public,anon,authenticated;

grant execute on function public.confirm_civic_issue_resolution(
  uuid,uuid,text,boolean,numeric
) to service_role;

-- REVIEW NOTES:
-- * SQL routines are server-callable only. Ensure Edge API validates the bearer token before calls.
-- * The database can check the actor's profile role, but cannot prove the actor_id belongs to the
--   original JWT when a service-role function is called; the Edge handler is part of the trust boundary.
-- * A category-wide advisory lock is intentionally conservative. Replace it with a robust
--   spatial partition lock that also locks neighboring partitions before scaling traffic.
-- * Test duplicate concurrency, report idempotency, vote insert/delete concurrency, state conflict,
--   audit event presence, staff demotion and rollback on a non-production Supabase database.
