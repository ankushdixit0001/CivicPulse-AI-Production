drop policy if exists "service role manages rate limits" on public.civic_api_rate_limits;
create policy "service role manages rate limits" on public.civic_api_rate_limits
for all to service_role using (true) with check (true);
