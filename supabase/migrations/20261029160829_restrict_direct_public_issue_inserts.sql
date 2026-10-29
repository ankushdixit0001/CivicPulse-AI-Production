-- Direct public/anonymous insert is not allowed. The server-side service-role
-- RPC validates submissions and enforces rate limits.
drop policy if exists "public may submit civic issues" on public.civic_issues;
drop policy if exists "anyone may submit issues" on public.civic_issues;
drop policy if exists "residents may submit own reports" on public.civic_issues;
create policy "residents may submit own reports" on public.civic_issues
for insert to authenticated with check ((select auth.uid()) = reporter_id);
