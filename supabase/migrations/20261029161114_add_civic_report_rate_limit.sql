create table if not exists public.civic_api_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0)
);
alter table public.civic_api_rate_limits enable row level security;

create or replace function public.consume_civic_report_limit(
  p_bucket_key text,
  p_limit integer default 5,
  p_window_seconds integer default 3600
)
returns boolean
language plpgsql
set search_path = ''
as $function$
declare
  current_count integer;
begin
  insert into public.civic_api_rate_limits(bucket_key, window_started_at, request_count)
  values (p_bucket_key, now(), 1)
  on conflict (bucket_key) do update
  set window_started_at = case
        when public.civic_api_rate_limits.window_started_at + pg_catalog.make_interval(secs => p_window_seconds) <= now()
        then now() else public.civic_api_rate_limits.window_started_at end,
      request_count = case
        when public.civic_api_rate_limits.window_started_at + pg_catalog.make_interval(secs => p_window_seconds) <= now()
        then 1 else public.civic_api_rate_limits.request_count + 1 end
  returning request_count into current_count;
  return current_count <= p_limit;
end
$function$;

revoke all on function public.consume_civic_report_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_civic_report_limit(text, integer, integer) to service_role;
