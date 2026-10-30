-- CivicPulse AI RLS design notes and safe helper template.
-- Apply only after the target schema is reviewed and tested in a disposable project.
-- This is not a production-ready complete policy set.

begin;
create schema if not exists private;

create or replace function private.has_tenant_role(p_tenant_id uuid, p_roles text[] default null)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = auth.uid()
      and m.is_active
      and (p_roles is null or m.role = any(p_roles))
  );
$$;

revoke all on function private.has_tenant_role(uuid,text[]) from public;
grant usage on schema private to authenticated;
grant execute on function private.has_tenant_role(uuid,text[]) to authenticated;

-- Example read policies only. Writes to lifecycle, assignment, AI, audit and queue tables
-- must go through trusted API/RPC functions that validate JWT actor, tenant and resource scope.
create policy tenant_member_read on public.tenants
for select to authenticated using (
  private.has_tenant_role(id, array['citizen','staff','department_admin','municipal_admin','platform_admin'])
);

create policy department_member_read on public.departments
for select to authenticated using (
  private.has_tenant_role(tenant_id, array['staff','department_admin','municipal_admin','platform_admin'])
);

create policy ward_member_read on public.wards
for select to authenticated using (
  private.has_tenant_role(tenant_id, array['staff','department_admin','municipal_admin','platform_admin'])
);

create policy membership_self_read on public.memberships
for select to authenticated using (user_id = auth.uid());

create policy category_read on public.issue_categories
for select to authenticated using (
  is_active and private.has_tenant_role(tenant_id, array['citizen','staff','department_admin','municipal_admin','platform_admin'])
);

create policy ai_analysis_staff_read on public.ai_analyses
for select to authenticated using (
  private.has_tenant_role(tenant_id, array['staff','department_admin','municipal_admin','platform_admin'])
);

-- No direct client policy for job_outbox or idempotency_records: service/worker only.
commit;

-- Mandatory hardening before use:
-- 1. Add department_id/ward_id checks to helper for scoped staff.
-- 2. Add citizen tenant membership provisioning or a trusted public-intake RPC.
-- 3. Add public issue visibility policies after reconciling existing civic_issues columns.
-- 4. Add Storage policies per bucket/path; Storage has its own RLS.
-- 5. Add column-level profile update protection via safe RPC/API allowlist.
-- 6. Test anon, two citizens, two departments, two tenants, manager and platform admin.
-- 7. Ensure SECURITY DEFINER functions have fixed search_path, minimal grants and no dynamic SQL.
