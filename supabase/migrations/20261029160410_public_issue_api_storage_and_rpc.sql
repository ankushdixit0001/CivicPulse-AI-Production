-- RPC used by the Supabase Edge Function. This initial version is retained for
-- bootstrap fidelity; the architecture foundation migration evolves its behavior.
create or replace function public.submit_civic_issue(
  p_reporter_id uuid,
  p_defect_type text,
  p_description text,
  p_lat double precision,
  p_lng double precision,
  p_landmark text default ''::text,
  p_zone text default 'unassigned'::text,
  p_priority_score smallint default 0,
  p_severity public.civic_issue_severity default 'LOW'::public.civic_issue_severity,
  p_confidence numeric default 0,
  p_before_damage_pct numeric default 0,
  p_before_image_path text default null::text,
  p_ai_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  point extensions.geography;
  found_issue public.civic_issues%rowtype;
  merged boolean := false;
begin
  if p_defect_type not in ('pothole','garbage','sewage','streetlight','unknown') then
    raise exception 'Unsupported issue category';
  end if;
  if char_length(trim(coalesce(p_description,''))) not between 5 and 2000 then
    raise exception 'Description must be between 5 and 2000 characters';
  end if;
  if p_lat is null or p_lat < -90 or p_lat > 90 or p_lng is null or p_lng < -180 or p_lng > 180 then
    raise exception 'Invalid coordinates';
  end if;
  point := extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326)::extensions.geography;
  select * into found_issue from public.civic_issues i
  where i.status <> 'Resolved' and i.defect_type = p_defect_type and extensions.st_dwithin(i.location, point, 15)
  order by extensions.st_distance(i.location, point) limit 1 for update;
  if found_issue.id is not null then
    update public.civic_issues
    set upvote_count=upvote_count+1, report_frequency=report_frequency+1, duplicate_count=duplicate_count+1
    where id=found_issue.id returning * into found_issue;
    merged := true;
    insert into public.issue_events(issue_id,actor_id,event_type,note,metadata)
    values(found_issue.id,p_reporter_id,'merged','Nearby report merged into this incident',jsonb_build_object('source','public_api'));
  else
    insert into public.civic_issues(
      reporter_id,defect_type,description,priority_score,severity,location,zone,confidence,
      upvote_count,report_frequency,duplicate_count,before_damage_pct,before_image_path,ai_metadata,landmark
    )
    values(
      p_reporter_id,p_defect_type,trim(p_description),greatest(0,least(100,coalesce(p_priority_score,0))),
      coalesce(p_severity,'LOW'),point,left(coalesce(nullif(trim(p_zone),''),'unassigned'),80),
      greatest(0,least(1,coalesce(p_confidence,0))),1,1,0,
      greatest(0,least(100,coalesce(p_before_damage_pct,0))),p_before_image_path,coalesce(p_ai_metadata,'{}'::jsonb),
      left(coalesce(p_landmark,''),200)
    )
    returning * into found_issue;
    insert into public.issue_events(issue_id,actor_id,event_type,new_status,note,metadata)
    values(found_issue.id,p_reporter_id,'created',found_issue.status,'Issue reported',jsonb_build_object('source','public_api'));
  end if;
  return jsonb_build_object(
    'merged',merged,
    'ticket',(to_jsonb(found_issue)-'location') || jsonb_build_object('location',extensions.st_asgeojson(found_issue.location)::jsonb)
  );
end;
$function$;

revoke all on function public.submit_civic_issue(uuid,text,text,double precision,double precision,text,text,smallint,public.civic_issue_severity,numeric,numeric,text,jsonb) from public, anon, authenticated;
grant execute on function public.submit_civic_issue(uuid,text,text,double precision,double precision,text,text,smallint,public.civic_issue_severity,numeric,numeric,text,jsonb) to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('civic-issue-images', 'civic-issue-images', true, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "api may upload civic issue images" on storage.objects;
create policy "api may upload civic issue images" on storage.objects
for insert to service_role with check (bucket_id = 'civic-issue-images');

drop policy if exists "public may read civic issue images" on storage.objects;
create policy "public may read civic issue images" on storage.objects
for select to anon, authenticated using (bucket_id = 'civic-issue-images');
