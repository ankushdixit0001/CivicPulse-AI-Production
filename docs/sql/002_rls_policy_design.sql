# Database RLS policy design (draft)

Apply only after `001_civicpulse_core.sql` in a disposable/local database. This file intentionally defines conservative policies. Validate with Supabase local tests and representative tenant fixtures before production use.

```sql
begin;

create or replace function private.has_tenant_role(p_tenant_id uuid, p_roles public.app_role[] default null)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = auth.uid()
      and m.is_active
      and (p_roles is null or m.role = any(p_roles))
  );
$$;

revoke all on function private.has_tenant_role(uuid, public.app_role[]) from public;
grant usage on schema private to authenticated;
grant execute on function private.has_tenant_role(uuid, public.app_role[]) to authenticated;

-- Tenant directory and public configuration
create policy tenant_active_read on public.tenants
for select to anon, authenticated using (is_active);

create policy department_read on public.departments
for select to anon, authenticated
using (is_active and exists (select 1 from public.tenants t where t.id = tenant_id and t.is_active));

create policy ward_read on public.wards
for select to anon, authenticated
using (is_active and exists (select 1 from public.tenants t where t.id = tenant_id and t.is_active));

create policy category_read on public.issue_categories
for select to anon, authenticated
using (is_active and exists (select 1 from public.tenants t where t.id = tenant_id and t.is_active));

-- Profiles: users can see/edit only their own safe profile through direct table access.
create policy profile_self_read on public.profiles
for select to authenticated using (id = auth.uid());

create policy profile_self_update on public.profiles
for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Memberships are private; user can read own memberships. Role writes are server-only.
create policy membership_self_read on public.memberships
for select to authenticated using (user_id = auth.uid());

-- Public issue fields are readable only when explicitly public.
create policy issue_public_read on public.civic_issues
for select to anon, authenticated using (is_public and exists (
  select 1 from public.tenants t where t.id = tenant_id and t.is_active
));

create policy issue_reporter_read on public.civic_issues
for select to authenticated using (reporter_id = auth.uid());

create policy issue_staff_read on public.civic_issues
for select to authenticated using (
  private.has_tenant_role(tenant_id, array['staff','department_admin','municipal_admin','platform_admin']::public.app_role[])
);

-- Authenticated citizen submission. Use Edge Function/service transaction for robust media + outbox creation.
create policy issue_citizen_insert on public.civic_issues
for insert to authenticated
with check (
  reporter_id = auth.uid()
  and private.has_tenant_role(tenant_id, array['citizen','staff','department_admin','municipal_admin','platform_admin']::public.app_role[])
);

-- No direct issue update/delete policy: state transitions go through the trusted API.
create policy media_public_read on public.issue_media
for select to anon, authenticated using (
  is_public and exists (
    select 1 from public.civic_issues i
    where i.id = issue_id and i.tenant_id = tenant_id and i.is_public
  )
);

create policy media_owner_read on public.issue_media
for select to authenticated using (
  exists (select 1 from public.civic_issues i where i.id = issue_id and i.tenant_id = tenant_id and i.reporter_id = auth.uid())
);

create policy event_public_read on public.issue_events
for select to anon, authenticated using (
  exists (select 1 from public.civic_issues i where i.id = issue_id and i.tenant_id = tenant_id and i.is_public)
);

create policy event_staff_read on public.issue_events
for select to authenticated using (
  private.has_tenant_role(tenant_id, array['staff','department_admin','municipal_admin','platform_admin']::public.app_role[])
);

create policy comment_public_read on public.issue_comments
for select to anon, authenticated using (
  moderation_status = 'visible' and exists (
    select 1 from public.civic_issues i where i.id = issue_id and i.tenant_id = tenant_id and i.is_public
  )
);

create policy comment_author_insert on public.issue_comments
for insert to authenticated with check (
  author_id = auth.uid()
  and exists (select 1 from public.civic_issues i where i.id = issue_id and i.tenant_id = tenant_id and i.is_public)
);

create policy comment_author_update on public.issue_comments
for update to authenticated using (author_id = auth.uid())
with check (author_id = auth.uid());

create policy vote_self_read on public.issue_votes
for select to authenticated using (user_id = auth.uid());

create policy vote_self_insert on public.issue_votes
for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from public.civic_issues i where i.id = issue_id and i.tenant_id = tenant_id and i.is_public)
);

create policy vote_self_update on public.issue_votes
for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy vote_self_delete on public.issue_votes
for delete to authenticated using (user_id = auth.uid());

-- Staff operational reads are tenant-scoped. Writes and transitions remain API-only.
create policy assignment_staff_read on public.issue_assignments
for select to authenticated using (
  assignee_id = auth.uid()
  or private.has_tenant_role(tenant_id, array['department_admin','municipal_admin','platform_admin']::public.app_role[])
);

create policy worklog_staff_read on public.work_logs
for select to authenticated using (
  staff_id = auth.uid()
  or private.has_tenant_role(tenant_id, array['department_admin','municipal_admin','platform_admin']::public.app_role[])
);

create policy analysis_staff_read on public.ai_analyses
for select to authenticated using (
  private.has_tenant_role(tenant_id, array['staff','department_admin','municipal_admin','platform_admin']::public.app_role[])
);

create policy duplicate_staff_read on public.duplicate_candidates
for select to authenticated using (
  private.has_tenant_role(tenant_id, array['staff','department_admin','municipal_admin','platform_admin']::public.app_role[])
);

create policy verification_staff_read on public.repair_verifications
for select to authenticated using (
  private.has_tenant_role(tenant_id, array['staff','department_admin','municipal_admin','platform_admin']::public.app_role[])
);

create policy sla_admin_read on public.sla_policies
for select to authenticated using (
  private.has_tenant_role(tenant_id, array['department_admin','municipal_admin','platform_admin']::public.app_role[])
);

create policy escalation_admin_read on public.escalations
for select to authenticated using (
  private.has_tenant_role(tenant_id, array['department_admin','municipal_admin','platform_admin']::public.app_role[])
);

create policy notification_recipient_read on public.notifications
for select to authenticated using (recipient_id = auth.uid());

create policy notification_recipient_update on public.notifications
for update to authenticated using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

-- No direct client policies for ai_provider_calls, notification_deliveries, audit_logs,
-- job_outbox or idempotency_records. Service-role/worker only.
commit;
```

## Important limitations requiring tests

1. The policy helper grants broad tenant role scope; department/ward-level membership scoping must be added before staff access is enabled.
2. The sample issue INSERT policy requires a citizen membership. Tenant onboarding must create this membership for each resident or use a trusted API policy with a different membership model.
3. Profile UPDATE policy is row-scoped but does not restrict columns. Expose a safe profile RPC or API allowlist; never allow clients to modify identity/role fields.
4. Direct client writes to issue status, assignments, work logs, AI analysis, audit and queue tables are intentionally denied.
5. Storage object policies must be written separately and must mirror issue/media ownership. Do not assume table RLS automatically protects Storage.
6. Run tests as anon, citizen A, citizen B, staff in department X, manager in department Y and municipal admin in another tenant. All cross-tenant reads/writes must fail.
