-- Issue events are append-only via the API policy: only staff/admin can append events.
drop policy if exists "users may append issue events" on public.issue_events;
drop policy if exists "public may append issue events" on public.issue_events;
drop policy if exists "staff may append issue events" on public.issue_events;
create policy "staff may append issue events" on public.issue_events
for insert to authenticated
with check (
  actor_id = (select auth.uid())
  and public.current_civic_role() in ('staff', 'admin')
);
