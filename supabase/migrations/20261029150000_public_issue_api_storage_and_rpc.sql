-- Public citizen reports, durable issue-image storage, and spatial duplicate merging.
alter table public.civic_issues alter column reporter_id drop not null;
alter table public.civic_issues drop constraint if exists civic_issues_reporter_id_fkey;
alter table public.civic_issues add constraint civic_issues_reporter_id_fkey
  foreign key (reporter_id) references auth.users(id) on delete set null;

drop policy if exists "authenticated users may read civic issues" on public.civic_issues;
drop policy if exists "public may read civic issues" on public.civic_issues;
create policy "public may read civic issues" on public.civic_issues
  for select to anon, authenticated using (true);
drop policy if exists "public may submit unclaimed reports" on public.civic_issues;
create policy "public may submit unclaimed reports" on public.civic_issues
  for insert to anon with check (reporter_id is null);
grant select on public.civic_issues to anon;
grant insert on public.civic_issues to anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('civic-issue-images', 'civic-issue-images', true, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public may read civic issue images" on storage.objects;
create policy "public may read civic issue images" on storage.objects
  for select to anon, authenticated using (bucket_id = 'civic-issue-images');
drop policy if exists "api may upload civic issue images" on storage.objects;
create policy "api may upload civic issue images" on storage.objects
  for insert to service_role with check (bucket_id = 'civic-issue-images');

create or replace function public.submit_civic_issue(
  p_reporter_id uuid, p_defect_type text, p_description text, p_lat double precision, p_lng double precision,
  p_landmark text default '', p_zone text default 'unassigned', p_priority_score smallint default 0,
  p_severity public.civic_issue_severity default 'LOW', p_confidence numeric default 0,
  p_before_damage_pct numeric default 0, p_before_image_path text default null, p_ai_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  point extensions.geography;
  found_issue public.civic_issues%rowtype;
  merged boolean := false;
begin
  if p_defect_type not in ('pothole','garbage','sewage','streetlight','unknown') then raise exception 'Unsupported issue category'; end if;
  if char_length(trim(coalesce(p_description,''))) not between 5 and 2000 then raise exception 'Description must be between 5 and 2000 characters'; end if;
  if p_lat is null or p_lat < -90 or p_lat > 90 or p_lng is null or p_lng < -180 or p_lng > 180 then raise exception 'Invalid coordinates'; end if;
  point := extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326)::extensions.geography;
  select * into found_issue from public.civic_issues i
  where i.status <> 'Resolved' and i.defect_type = p_defect_type and extensions.st_dwithin(i.location, point, 15)
  order by extensions.st_distance(i.location, point) limit 1 for update;
  if found_issue.id is not null then
    update public.civic_issues set upvote_count=upvote_count+1, report_frequency=report_frequency+1, duplicate_count=duplicate_count+1
    where id=found_issue.id returning * into found_issue;
    merged := true;
    insert into public.issue_events(issue_id,actor_id,event_type,note,metadata)
    values(found_issue.id,p_reporter_id,'merged','Nearby report merged into this incident',jsonb_build_object('source','public_api'));
  else
    insert into public.civic_issues(reporter_id,defect_type,description,priority_score,severity,location,zone,confidence,upvote_count,report_frequency,duplicate_count,before_damage_pct,before_image_path,ai_metadata,landmark)
    values(p_reporter_id,p_defect_type,trim(p_description),greatest(0,least(100,coalesce(p_priority_score,0))),coalesce(p_severity,'LOW'),point,left(coalesce(nullif(trim(p_zone),''),'unassigned'),80),greatest(0,least(1,coalesce(p_confidence,0))),1,1,0,greatest(0,least(100,coalesce(p_before_damage_pct,0))),p_before_image_path,coalesce(p_ai_metadata,'{}'::jsonb),left(coalesce(p_landmark,''),200))
    returning * into found_issue;
    insert into public.issue_events(issue_id,actor_id,event_type,new_status,note,metadata)
    values(found_issue.id,p_reporter_id,'created',found_issue.status,'Issue reported',jsonb_build_object('source','public_api'));
  end if;
  return jsonb_build_object('merged',merged,'ticket',(to_jsonb(found_issue)-'location')||jsonb_build_object('location',extensions.st_asgeojson(found_issue.location)::jsonb));
end;
$$;
revoke all on function public.submit_civic_issue(uuid,text,text,double precision,double precision,text,text,smallint,public.civic_issue_severity,numeric,numeric,text,jsonb) from public,anon,authenticated;
grant execute on function public.submit_civic_issue(uuid,text,text,double precision,double precision,text,text,smallint,public.civic_issue_severity,numeric,numeric,text,jsonb) to service_role;

create or replace function public.refresh_issue_vote_count()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  update public.civic_issues set upvote_count=(select count(*) from public.issue_votes v where v.issue_id=coalesce(new.issue_id,old.issue_id))
  where id=coalesce(new.issue_id,old.issue_id);
  return coalesce(new,old);
end
$$;
drop trigger if exists issue_votes_count_after_insert on public.issue_votes;
drop trigger if exists issue_votes_count_after_delete on public.issue_votes;
create trigger issue_votes_count_after_insert after insert on public.issue_votes for each row execute function public.refresh_issue_vote_count();
create trigger issue_votes_count_after_delete after delete on public.issue_votes for each row execute function public.refresh_issue_vote_count();
