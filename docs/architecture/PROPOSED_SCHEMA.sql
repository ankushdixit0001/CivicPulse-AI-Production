-- CivicPulse proposed additive schema for future features.
-- DESIGN ONLY. NOT APPLIED TO THE LIVE DATABASE.
-- Reconcile current schema and RLS, then test on staging before application.
-- Existing civic_issues, profiles, issue_events, issue_comments, issue_votes
-- and civic_api_rate_limits are intentionally not recreated.

create table if not exists public.issue_media (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.civic_issues(id) on delete cascade,
  uploaded_by uuid null references auth.users(id) on delete set null,
  media_kind text not null check (media_kind in
    ('report', 'repair_before', 'repair_after', 'supporting', 'moderation')),
  bucket_id text not null,
  object_path text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint not null check (byte_size between 1 and 8388608),
  sha256 text null check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  width integer null check (width is null or width between 1 and 6000),
  height integer null check (height is null or height between 1 and 6000),
  visibility text not null default 'public'
    check (visibility in ('public', 'staff', 'owner')),
  created_at timestamptz not null default now(),
  constraint issue_media_bucket_path_unique unique (bucket_id, object_path)
);

create index if not exists issue_media_issue_created_idx
  on public.issue_media (issue_id, created_at desc);
create index if not exists issue_media_uploader_created_idx
  on public.issue_media (uploaded_by, created_at desc);

create table if not exists public.ai_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid null references public.civic_issues(id) on delete set null,
  requested_by uuid null references auth.users(id) on delete set null,
  task_type text not null check (task_type in
    ('classify_issue', 'chat', 'verify_repair', 'summarize')),
  status text not null check (status in ('success', 'partial', 'unavailable', 'failed')),
  provider text null,
  model text null,
  provider_request_id text null,
  latency_ms integer null check (latency_ms is null or latency_ms >= 0),
  input_media_id uuid null references public.issue_media(id) on delete set null,
  output_schema_version text not null default '1',
  result jsonb not null default '{}'::jsonb,
  error_code text null,
  created_at timestamptz not null default now()
);

create index if not exists ai_analysis_task_status_created_idx
  on public.ai_analysis_runs (task_type, status, created_at desc);
create index if not exists ai_analysis_issue_created_idx
  on public.ai_analysis_runs (issue_id, created_at desc);

create table if not exists public.issue_assignments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.civic_issues(id) on delete cascade,
  assigned_to uuid not null references public.profiles(id) on delete restrict,
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  assignment_status text not null default 'active'
    check (assignment_status in ('active', 'released', 'completed')),
  note text null check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  ended_at timestamptz null,
  check ((assignment_status = 'active' and ended_at is null)
      or (assignment_status <> 'active' and ended_at is not null))
);

create unique index if not exists issue_assignments_one_active_idx
  on public.issue_assignments (issue_id) where assignment_status = 'active';
create index if not exists issue_assignments_staff_active_idx
  on public.issue_assignments (assigned_to, created_at desc)
  where assignment_status = 'active';

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default false,
  push_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  issue_id uuid null references public.civic_issues(id) on delete set null,
  channel text not null check (channel in ('in_app', 'email', 'push')),
  event_key text not null,
  title text not null check (char_length(title) between 1 and 160),
  body text not null check (char_length(body) between 1 and 2000),
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'sent', 'failed', 'suppressed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz null,
  sent_at timestamptz null,
  provider_message_id text null,
  safe_error_code text null,
  created_at timestamptz not null default now(),
  constraint notifications_event_channel_unique unique (recipient_id, event_key, channel)
);

create index if not exists notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);
create index if not exists notifications_retry_idx
  on public.notifications (delivery_status, next_attempt_at)
  where delivery_status in ('pending', 'failed');

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz null,
  sent_at timestamptz null,
  safe_error_code text null,
  created_at timestamptz not null default now()
);

create index if not exists notification_outbox_claim_idx
  on public.notification_outbox (status, next_attempt_at)
  where status in ('pending', 'failed');

create table if not exists public.jurisdictions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  code text not null unique check (char_length(code) between 1 and 32),
  boundary geography(MultiPolygon, 4326) null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jurisdictions_boundary_gix
  on public.jurisdictions using gist (boundary);

create table if not exists public.staff_jurisdictions (
  staff_id uuid not null references public.profiles(id) on delete cascade,
  jurisdiction_id uuid not null references public.jurisdictions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (staff_id, jurisdiction_id)
);

-- Optional jurisdiction binding; current issue writes may leave this NULL until
-- municipal boundaries and assignment rules have been verified.
alter table public.civic_issues
  add column if not exists jurisdiction_id uuid
  references public.jurisdictions(id) on delete set null;
create index if not exists civic_issues_jurisdiction_status_idx
  on public.civic_issues (jurisdiction_id, status, created_at desc);

create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_searches_user_name_unique unique (user_id, name)
);
create index if not exists saved_searches_user_updated_idx
  on public.saved_searches (user_id, updated_at desc);

create table if not exists public.sla_policies (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid null references public.jurisdictions(id) on delete set null,
  defect_type text null check (defect_type is null or defect_type in
    ('pothole', 'garbage', 'sewage', 'streetlight', 'unknown')),
  severity text null check (severity is null or severity in ('LOW', 'MEDIUM', 'CRITICAL')),
  first_response_minutes integer null check
    (first_response_minutes is null or first_response_minutes > 0),
  resolution_target_minutes integer null check
    (resolution_target_minutes is null or resolution_target_minutes > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (first_response_minutes is not null or resolution_target_minutes is not null)
);
create index if not exists sla_policies_active_scope_idx
  on public.sla_policies (active, jurisdiction_id, defect_type, severity);

create table if not exists public.moderation_flags (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid null references public.civic_issues(id) on delete cascade,
  submitted_by uuid null references auth.users(id) on delete set null,
  reason text not null check (reason in
    ('spam', 'personal_data', 'abuse', 'wrong_location', 'duplicate', 'other')),
  details text null check (details is null or char_length(details) <= 1000),
  state text not null default 'open' check (state in ('open', 'reviewing', 'closed')),
  reviewed_by uuid null references public.profiles(id) on delete set null,
  resolution_note text null check (resolution_note is null or char_length(resolution_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists moderation_flags_state_created_idx
  on public.moderation_flags (state, created_at desc);

create table if not exists public.idempotency_keys (
  scope text not null,
  key text not null,
  subject_id uuid null,
  request_hash text not null,
  response_status integer null,
  response_body jsonb null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (scope, key),
  check (char_length(scope) between 1 and 80),
  check (char_length(key) between 8 and 200),
  check (expires_at > created_at)
);

create index if not exists idempotency_keys_expiry_idx
  on public.idempotency_keys (expires_at);

-- SECURITY GATE BEFORE APPLYING:
-- 1. Enable RLS on all new tables and add narrowly scoped policies.
-- 2. Default-deny browser access to AI run details, outbox and rate-limit data.
-- 3. Use server-only service-role access for outbox processing and AI run writes.
-- 4. Explicitly grant only safe resident access to notifications/preferences/media.
-- 5. Do not change Storage visibility or legacy image paths in this migration.
-- 6. Add ownership/role tests and run Supabase security advisors.
