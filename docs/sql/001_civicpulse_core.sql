-- CivicPulse AI target-state tenant extension (design reference only).
-- Do NOT apply to production without migration reconciliation, backup, local validation and review.
begin;
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  country_code char(2) not null default 'IN',
  default_locale text not null default 'en-IN',
  timezone text not null default 'Asia/Kolkata',
  is_active boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  unique (tenant_id, code),
  unique (tenant_id, id)
);

create table if not exists public.wards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  boundary extensions.geometry(MultiPolygon,4326),
  is_active boolean not null default true,
  unique (tenant_id, code),
  unique (tenant_id, id)
);
create index if not exists wards_boundary_gix on public.wards using gist(boundary);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('citizen','staff','department_admin','municipal_admin','platform_admin')),
  department_id uuid,
  ward_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (tenant_id,department_id) references public.departments(tenant_id,id),
  foreign key (tenant_id,ward_id) references public.wards(tenant_id,id),
  unique (tenant_id,user_id,role,department_id,ward_id)
);
create index if not exists memberships_user_tenant_idx on public.memberships(user_id,tenant_id) where is_active;

create table if not exists public.issue_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  default_department_id uuid,
  requires_photo boolean not null default true,
  priority_weight numeric(5,2) not null default 1 check(priority_weight between 0 and 10),
  is_active boolean not null default true,
  foreign key (tenant_id,default_department_id) references public.departments(tenant_id,id),
  unique (tenant_id,code),
  unique (tenant_id,id)
);

-- These are target extension tables. Reconcile with the live civic_issues schema before adding
-- tenant_id/category_id or changing existing enums. The canonical issue table is not recreated here.
create table if not exists public.ai_analyses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  issue_id uuid not null references public.civic_issues(id) on delete cascade,
  task_type text not null,
  status text not null check(status in ('queued','processing','completed','partial','unavailable','failed')),
  provider_id text,
  model_id text,
  model_version text,
  prompt_version text,
  predicted_category text,
  confidence numeric(5,4) check(confidence is null or confidence between 0 and 1),
  severity text,
  damage_coverage_pct numeric(5,2) check(damage_coverage_pct is null or damage_coverage_pct between 0 and 100),
  evidence jsonb not null default '[]'::jsonb,
  human_review_required boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists ai_analyses_issue_created_idx on public.ai_analyses(issue_id,created_at desc);

create table if not exists public.job_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  job_type text not null,
  payload jsonb not null,
  idempotency_key text not null unique,
  status text not null default 'queued' check(status in ('queued','processing','retry_wait','succeeded','failed','dead_letter')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists job_outbox_queue_idx on public.job_outbox(available_at) where status in ('queued','retry_wait');

create table if not exists public.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete cascade,
  idempotency_key text not null,
  request_hash text not null,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '24 hours',
  unique (tenant_id,actor_id,idempotency_key)
);

-- RLS is enabled with no client policies by default (deny-by-default). Add reviewed policies
-- after the tenant membership model and Storage object visibility rules are finalized.
alter table public.tenants enable row level security;
alter table public.departments enable row level security;
alter table public.wards enable row level security;
alter table public.memberships enable row level security;
alter table public.issue_categories enable row level security;
alter table public.ai_analyses enable row level security;
alter table public.job_outbox enable row level security;
alter table public.idempotency_records enable row level security;
commit;
