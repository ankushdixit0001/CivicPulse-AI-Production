-- Public submissions must pass through the Edge Function validation and spatial deduplication RPC.
drop policy if exists "public may submit unclaimed reports" on public.civic_issues;
revoke insert on public.civic_issues from anon;
