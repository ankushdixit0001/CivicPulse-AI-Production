-- Run after supabase db reset against the local project.
-- Read-only assertions: intentionally does not create users or mutate application data.
do $$
declare
  v_missing text;
begin
  select string_agg(t, ', ') into v_missing
  from unnest(array['profiles','civic_issues','issue_events','issue_comments','issue_votes','civic_api_rate_limits']) t
  where not coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
                      where n.nspname='public' and c.relname=t),false);
  if v_missing is not null then raise exception 'RLS disabled on: %',v_missing; end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='civic_issues'
    and cmd='SELECT' and 'anon'=any(roles)) then
    raise exception 'Anonymous issue read policy missing';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='issue_events'
    and cmd='INSERT' and 'authenticated'=any(roles)) then
    raise exception 'Authenticated users must not directly append audit events';
  end if;
  if has_table_privilege('anon','public.issue_comments','SELECT') then
    raise exception 'Anonymous users must not read comments';
  end if;
  if has_table_privilege('authenticated','public.civic_api_rate_limits','SELECT') then
    raise exception 'Authenticated users must not read rate limits';
  end if;
  if not has_function_privilege('service_role',
    'public.confirm_civic_issue_resolution(uuid,uuid,boolean,text)','EXECUTE') then
    raise exception 'Service role cannot execute resolution routine';
  end if;
  if has_function_privilege('anon',
    'public.confirm_civic_issue_resolution(uuid,uuid,boolean,text)','EXECUTE') then
    raise exception 'Anonymous users can execute privileged resolution routine';
  end if;
end $$;
