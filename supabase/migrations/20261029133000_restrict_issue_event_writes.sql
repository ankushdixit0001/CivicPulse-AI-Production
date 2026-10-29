-- Audit events are privileged workflow records. Residents must not be able to
-- fabricate assignment/status-change history through the Data API.
drop policy if exists "issue event actor creates events" on public.issue_events;

create policy "staff may append issue events" on public.issue_events
for insert to authenticated
with check (
  actor_id = (select auth.uid())
  and public.current_civic_role() in ('staff', 'admin')
);
