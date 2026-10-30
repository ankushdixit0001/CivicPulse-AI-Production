-- CivicPulse AI core database design baseline
-- Draft only: validate in local/disposable Supabase project before any production use.
-- Requires Supabase-managed auth schema and PostGIS extension availability.
begin;

create extension if not exists pgcrypto;
create extension if not exists postgis;
-- Enable vector only after choosing and freezing embedding dimensions:
-- create extension if not exists vector;

create schema if not exists private;

create type public.app_role as enum ('citizen','staff','department_admin','municipal_admin','platform_admin');
create type public.issue_status as enum ('submitted','triaged','assigned','accepted','in_progress','awaiting_verification','resolved','reopened','rejected');
create type public.analysis_status as enum ('queued','processing','completed','partial','unavailable','failed');
create type public.priority_level as enum ('low','medium','high','critical');
create type public.media_kind as enum ('initial','repair_before','repair_after','supporting');
create type public.job_status as enum ('queued','processing','retry_wait','succeeded','failed','dead_letter');
create type public.review_decision as enum ('pending','approved','rejected','manual_override');

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  country_code char(2) not null default 'IN',
  default_locale text not null default 'en-IN',
  timezone text not null default 'Asia/Kolkata',
  is_active boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$')
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  phone text,
  avatar_object_path text,
  preferred_locale text not null default 'en-IN',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, code),
  unique (tenant_id, id)
);

create table public.wards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  boundary geometry(MultiPolygon, 4326),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, code),
  unique (tenant_id, id)
);
create index wards_boundary_gix on public.wards using gist (boundary);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  department_id uuid,
  ward_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, department_id) references public.departments(tenant_id, id),
  foreign key (tenant_id, ward_id) references public.wards(tenant_id, id),
  unique nulls not distinct (tenant_id, user_id, role, department_id, ward_id)
);
create index memberships_user_tenant_idx on public.memberships(user_id, tenant_id) where is_active;

create table public.issue_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  default_department_id uuid,
  requires_photo boolean not null default true,
  is_active boolean not null default true,
  priority_weight numeric(5,2) not null default 1.0 check (priority_weight between 0 and 10),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, default_department_id) references public.departments(tenant_id, id),
  unique (tenant_id, code),
  unique (tenant_id, id)
);

create table public.civic_issues (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  reference_code text not null,
  reporter_id uuid references public.profiles(id) on delete set null,
  category_id uuid not null,
  ward_id uuid,
  description text not null,
  address_label text,
  location geography(Point, 4326) not null,
  status public.issue_status not null default 'submitted',
  analysis_status public.analysis_status not null default 'queued',
  priority public.priority_level not null default 'medium',
  priority_score numeric(5,2) not null default 0 check (priority_score between 0 and 100),
  priority_reason_codes text[] not null default '{}',
  is_public boolean not null default true,
  submitted_at timestamptz not null default now(),
  due_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, category_id) references public.issue_categories(tenant_id, id),
  foreign key (tenant_id, ward_id) references public.wards(tenant_id, id),
  unique (tenant_id, reference_code),
  unique (tenant_id, id),
  check (char_length(description) between 10 and 3000)
);
create index civic_issues_tenant_status_created_idx on public.civic_issues(tenant_id, status, created_at desc);
create index civic_issues_tenant_category_created_idx on public.civic_issues(tenant_id, category_id, created_at desc);
create index civic_issues_location_gix on public.civic_issues using gist (location);
create index civic_issues_open_due_idx on public.civic_issues(tenant_id, due_at) where status not in ('resolved','rejected');

create table public.issue_media (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  issue_id uuid not null,
  bucket_id text not null,
  object_path text not null,
  kind public.media_kind not null default 'initial',
  content_type text not null,
  byte_size bigint not null check (byte_size between 1 and 8388608),
  width integer,
  height integer,
  sha256 text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, issue_id) references public.civic_issues(tenant_id, id) on delete cascade,
  unique (bucket_id, object_path),
  unique (tenant_id, id),
  check (content_type in ('image/jpeg','image/png','image/webp'))
);
create index issue_media_issue_idx on public.issue_media(issue_id, created_at);

create table public.issue_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  issue_id uuid not null,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  old_status public.issue_status,
  new_status public.issue_status,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, issue_id) references public.civic_issues(tenant_id, id) on delete cascade
);
create index issue_events_issue_created_idx on public.issue_events(issue_id, created_at desc);

create table public.issue_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  issue_id uuid not null,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null check (char_length(body) between 1 and 3000),
  moderation_status text not null default 'visible' check (moderation_status in ('visible','hidden','pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, issue_id) references public.civic_issues(tenant_id, id) on delete cascade
);
create index issue_comments_issue_created_idx on public.issue_comments(issue_id, created_at);

create table public.issue_votes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  issue_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  vote smallint not null default 1 check (vote in (-1,1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, issue_id) references public.civic_issues(tenant_id, id) on delete cascade,
  unique (issue_id, user_id)
);

create table public.issue_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  issue_id uuid not null,
  department_id uuid not null,
  assignee_id uuid references public.profiles(id) on delete set null,
  assigned_by uuid references public.profiles(id) on delete set null,
  state text not null default 'assigned' check (state in ('assigned','accepted','rejected','completed','cancelled')),
  due_at timestamptz,
  accepted_at timestamptz,
  completed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, issue_id) references public.civic_issues(tenant_id, id) on delete cascade,
  foreign key (tenant_id, department_id) references public.departments(tenant_id, id)
);
create index issue_assignments_assignee_state_idx on public.issue_assignments(assignee_id, state, due_at);
create index issue_assignments_issue_created_idx on public.issue_assignments(issue_id, created_at desc);

create table public.work_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  issue_id uuid not null,
  assignment_id uuid references public.issue_assignments(id) on delete set null,
  staff_id uuid references public.profiles(id) on delete set null,
  work_type text not null,
  description text not null check (char_length(description) between 1 and 3000),
  minutes_spent integer check (minutes_spent is null or minutes_spent between 0 and 100000),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, issue_id) references public.civic_issues(tenant_id, id) on delete cascade
);
create index work_logs_issue_created_idx on public.work_logs(issue_id, created_at desc);

create table public.ai_analyses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  issue_id uuid not null,
  task_type text not null check (task_type in ('civic_defect_triage','description_assist','duplicate_embedding','repair_verification','civic_chat')),
  status public.analysis_status not null,
  provider_id text,
  model_id text,
  model_version text,
  prompt_version text,
  requested_category text,
  predicted_category text,
  category_confidence numeric(5,4) check (category_confidence is null or category_confidence between 0 and 1),
  severity_prediction public.priority_level,
  severity_confidence numeric(5,4) check (severity_confidence is null or severity_confidence between 0 and 1),
  damage_coverage_pct numeric(5,2) check (damage_coverage_pct is null or damage_coverage_pct between 0 and 100),
  safety_risk boolean,
  summary text,
  evidence jsonb not null default '[]'::jsonb,
  bounding_boxes jsonb not null default '[]'::jsonb,
  recommended_action text,
  human_review_required boolean not null default true,
  limitations text[] not null default '{}',
  error_code text,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (tenant_id, issue_id) references public.civic_issues(tenant_id, id) on delete cascade
);
create index ai_analyses_issue_created_idx on public.ai_analyses(issue_id, created_at desc);
create index ai_analyses_status_created_idx on public.ai_analyses(status, created_at);

create table public.ai_provider_calls (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.ai_analyses(id) on delete cascade,
  provider_id text not null,
  model_id text,
  request_id text,
  status text not null check (status in ('succeeded','failed','timeout','rate_limited','rejected')),
  http_status integer,
  latency_ms integer,
  input_units numeric,
  output_units numeric,
  estimated_cost numeric(12,6),
  error_code text,
  created_at timestamptz not null default now()
);
create index ai_provider_calls_provider_created_idx on public.ai_provider_calls(provider_id, created_at desc);

create table public.duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  issue_id uuid not null,
  candidate_issue_id uuid not null,
  distance_m numeric(10,2),
  category_match numeric(5,4),
  text_similarity numeric(5,4),
  image_similarity numeric(5,4),
  combined_score numeric(5,4) not null check (combined_score between 0 and 1),
  status text not null default 'pending' check (status in ('pending','confirmed','dismissed','merged')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, issue_id) references public.civic_issues(tenant_id, id) on delete cascade,
  foreign key (tenant_id, candidate_issue_id) references public.civic_issues(tenant_id, id) on delete cascade,
  check (issue_id <> candidate_issue_id),
  unique (issue_id, candidate_issue_id)
);
create index duplicate_candidates_score_idx on public.duplicate_candidates(tenant_id, status, combined_score desc);

create table public.repair_verifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  issue_id uuid not null,
  before_media_id uuid,
  after_media_id uuid not null,
  analysis_id uuid references public.ai_analyses(id) on delete set null,
  suggested_repaired boolean,
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  resolution_score numeric(5,2) check (resolution_score is null or resolution_score between 0 and 100),
  evidence jsonb not null default '[]'::jsonb,
  decision public.review_decision not null default 'pending',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, issue_id) references public.civic_issues(tenant_id, id) on delete cascade,
  foreign key (tenant_id, before_media_id) references public.issue_media(tenant_id, id) on delete set null,
  foreign key (tenant_id, after_media_id) references public.issue_media(tenant_id, id) on delete restrict
);
create index repair_verifications_issue_created_idx on public.repair_verifications(issue_id, created_at desc);

create table public.sla_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid,
  priority public.priority_level not null,
  target_minutes integer not null check (target_minutes > 0),
  escalation_after_minutes integer check (escalation_after_minutes is null or escalation_after_minutes > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, category_id) references public.issue_categories(tenant_id, id)
);
create index sla_policies_lookup_idx on public.sla_policies(tenant_id, category_id, priority) where is_active;

create table public.escalations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  issue_id uuid not null,
  policy_id uuid references public.sla_policies(id) on delete set null,
  level integer not null default 1 check (level between 1 and 10),
  reason text not null,
  state text not null default 'open' check (state in ('open','acknowledged','resolved','cancelled')),
  triggered_at timestamptz not null default now(),
  acknowledged_by uuid references public.profiles(id) on delete set null,
  acknowledged_at timestamptz,
  foreign key (tenant_id, issue_id) references public.civic_issues(tenant_id, id) on delete cascade
);
create index escalations_open_idx on public.escalations(tenant_id, triggered_at) where state = 'open';

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  issue_id uuid references public.civic_issues(id) on delete set null,
  type text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_recipient_created_idx on public.notifications(recipient_id, created_at desc);
create index notifications_unread_idx on public.notifications(recipient_id, created_at desc) where read_at is null;

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  channel text not null check (channel in ('email','web_push')),
  destination_hash text,
  status text not null default 'queued' check (status in ('queued','sending','sent','retry_wait','failed','dead_letter')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now()
);
create index notification_deliveries_queue_idx on public.notification_deliveries(status, available_at) where status in ('queued','retry_wait');

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id uuid,
  request_id text,
  ip_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_tenant_created_idx on public.audit_logs(tenant_id, created_at desc);
create index audit_logs_actor_created_idx on public.audit_logs(actor_id, created_at desc);

create table public.job_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  job_type text not null,
  payload jsonb not null,
  idempotency_key text not null unique,
  status public.job_status not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index job_outbox_queue_idx on public.job_outbox(available_at, created_at) where status in ('queued','retry_wait');

create table public.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete cascade,
  idempotency_key text not null,
  request_hash text not null,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  unique (tenant_id, actor_id, idempotency_key)
);

-- SECURITY NOTE:
-- This migration deliberately does not enable permissive RLS policies.
-- Add policies only after tenant membership and security-definer helper functions
-- have been reviewed and tested against your actual tenant/role model.
-- In a fresh Supabase deployment, enable RLS on every table before exposing API access.
alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.departments enable row level security;
alter table public.wards enable row level security;
alter table public.memberships enable row level security;
alter table public.issue_categories enable row level security;
alter table public.civic_issues enable row level security;
alter table public.issue_media enable row level security;
alter table public.issue_events enable row level security;
alter table public.issue_comments enable row level security;
alter table public.issue_votes enable row level security;
alter table public.issue_assignments enable row level security;
alter table public.work_logs enable row level security;
alter table public.ai_analyses enable row level security;
alter table public.ai_provider_calls enable row level security;
alter table public.duplicate_candidates enable row level security;
alter table public.repair_verifications enable row level security;
alter table public.sla_policies enable row level security;
alter table public.escalations enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.audit_logs enable row level security;
alter table public.job_outbox enable row level security;
alter table public.idempotency_records enable row level security;

commit;
