-- CivicPulse AI additive architecture migration (do not reset production data).
-- This establishes metadata/audit tables for the rebuild. Existing APIs do not use
-- every new table yet; callers must be migrated in a later reviewed release.

create extension if not exists postgis;

-- Assignment destination catalog.
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (char_length(code) between 1 and 60),
  name text not null check (char_length(name) between 1 and 120),
  active boolean not null default true,
  supported_defect_types text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.departments enable row level security;

-- Human-facing reference number and operational metadata; preserve the current
-- status enum and current before/after image-path columns for compatibility.
alter table public.civic_issues
  add column if not exists public_reference text,
  add column if not exists department_id uuid references public.departments(id) on delete set null,
  add column if not exists sla_due_at timestamptz,
  add column if not exists published_at timestamptz,
  add column if not exists moderation_status text not null default 'approved'
    check (moderation_status in ('pending', 'approved', 'rejected', 'needs_review')),
  add column if not exists priority_rule_version text not null default 'v1';

create unique index if not exists civic_issues_public_reference_uidx
  on public.civic_issues(public_reference) where public_reference is not null;
create index if not exists civic_issues_status_priority_created_idx
  on public.civic_issues(status, priority_score desc, created_at desc);
create index if not exists civic_issues_category_status_created_idx
  on public.civic_issues(defect_type, status, created_at desc);
create index if not exists civic_issues_assigned_queue_idx
  on public.civic_issues(assigned_to, status, priority_score desc);
create index if not exists civic_issues_location_gix
  on public.civic_issues using gist(location);
create index if not exists civic_issues_department_status_idx
  on public.civic_issues(department_id, status, priority_score desc);

-- Preserve each submission independently when several reports refer to one ticket.
create table if not exists public.issue_reports (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.civic_issues(id) on delete restrict,
  reporter_id uuid references auth.users(id) on delete set null,
  defect_type text not null check (defect_type in ('pothole', 'garbage', 'sewage', 'streetlight', 'unknown')),
  description text not null check (char_length(description) between 5 and 2000),
  ai_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(ai_metadata) = 'object'),
  ai_confidence numeric(5,4) not null default 0 check (ai_confidence between 0 and 1),
  ai_priority_score smallint not null default 0 check (ai_priority_score between 0 and 100),
  ai_severity public.civic_issue_severity not null default 'LOW',
  location extensions.geography(Point, 4326) not null,
  landmark text check (landmark is null or char_length(landmark) <= 200),
  submission_status text not null default 'canonical'
    check (submission_status in ('canonical', 'merged', 'needs_review', 'rejected', 'spam')),
  idempotency_subject text not null check (char_length(idempotency_subject) between 1 and 160),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 160),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 2000),
  created_at timestamptz not null default now(),
  constraint issue_reports_subject_key_uidx unique (idempotency_subject, idempotency_key)
);
create index if not exists issue_reports_issue_created_idx on public.issue_reports(issue_id, created_at desc);
create index if not exists issue_reports_reporter_created_idx on public.issue_reports(reporter_id, created_at desc);
create index if not exists issue_reports_location_gix on public.issue_reports using gist(location);
alter table public.issue_reports enable row level security;

-- Metadata for objects in Supabase Storage. Object access is enforced separately
-- with Storage policies/signed URLs; this table does not make a bucket public.
create table if not exists public.issue_media (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.civic_issues(id) on delete restrict,
  report_id uuid references public.issue_reports(id) on delete set null,
  uploaded_by uuid references auth.users(id) on delete set null,
  bucket_id text not null,
  object_path text not null,
  media_role text not null check (media_role in ('report_photo', 'repair_before', 'repair_after', 'public_thumbnail', 'other')),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 8388608),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  sha256 text,
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  moderation_status text not null default 'pending' check (moderation_status in ('pending', 'approved', 'rejected', 'needs_review')),
  created_at timestamptz not null default now(),
  constraint issue_media_object_uidx unique (bucket_id, object_path)
);
create index if not exists issue_media_issue_role_created_idx on public.issue_media(issue_id, media_role, created_at desc);
create index if not exists issue_media_report_idx on public.issue_media(report_id);
alter table public.issue_media enable row level security;

-- Preserve the assignment chain; civic_issues.assigned_to remains the active
-- assignee projection until all callers are migrated.
create table if not exists public.issue_assignments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.civic_issues(id) on delete restrict,
  assignee_id uuid not null references public.profiles(id) on delete restrict,
  department_id uuid references public.departments(id) on delete set null,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  note text check (note is null or char_length(note) <= 2000),
  constraint issue_assignments_end_after_start check (ended_at is null or ended_at >= assigned_at)
);
create unique index if not exists issue_assignments_one_active_per_issue_uidx
  on public.issue_assignments(issue_id) where ended_at is null;
create index if not exists issue_assignments_assignee_active_idx
  on public.issue_assignments(assignee_id, assigned_at desc) where ended_at is null;
create index if not exists issue_assignments_issue_history_idx
  on public.issue_assignments(issue_id, assigned_at desc);
alter table public.issue_assignments enable row level security;

-- Audit every AI task separately from the compatibility snapshot in ai_metadata.
create table if not exists public.ai_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  issue_id uuid references public.civic_issues(id) on delete set null,
  report_id uuid references public.issue_reports(id) on delete set null,
  task text not null check (task in ('image_triage', 'chat', 'repair_verification', 'translation', 'semantic_match')),
  provider text not null default 'none',
  model text,
  provider_status text not null check (provider_status in ('success', 'partial', 'unavailable', 'error')),
  schema_version text not null default '1.0',
  prompt_version text,
  input_media_id uuid references public.issue_media(id) on delete set null,
  comparison_media_id uuid references public.issue_media(id) on delete set null,
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  confidence numeric check (confidence is null or confidence between 0 and 1),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  error_code text check (error_code is null or char_length(error_code) <= 100),
  created_at timestamptz not null default now()
);
create index if not exists ai_analysis_runs_issue_created_idx on public.ai_analysis_runs(issue_id, created_at desc);
create index if not exists ai_analysis_runs_task_status_created_idx on public.ai_analysis_runs(task, provider_status, created_at desc);
alter table public.ai_analysis_runs enable row level security;

-- Human corrections feed offline evaluation; do not automatically retrain from votes.
create table if not exists public.ai_feedback (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id uuid not null references public.ai_analysis_runs(id) on delete restrict,
  issue_id uuid references public.civic_issues(id) on delete set null,
  reviewer_id uuid not null references public.profiles(id) on delete restrict,
  accepted boolean not null,
  corrected_defect_type text check (corrected_defect_type is null or corrected_defect_type in ('pothole', 'garbage', 'sewage', 'streetlight', 'unknown')),
  corrected_severity text check (corrected_severity is null or corrected_severity in ('LOW', 'MEDIUM', 'CRITICAL')),
  review_note text check (review_note is null or char_length(review_note) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists ai_feedback_run_created_idx on public.ai_feedback(analysis_run_id, created_at desc);
create index if not exists ai_feedback_reviewer_created_idx on public.ai_feedback(reviewer_id, created_at desc);
alter table public.ai_feedback enable row level security;

-- Event subscriptions and transactional outbox. Delivery worker is a later phase.
create table if not exists public.issue_subscriptions (
  issue_id uuid not null references public.civic_issues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email_enabled boolean not null default true,
  push_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (issue_id, user_id)
);
create index if not exists issue_subscriptions_user_created_idx on public.issue_subscriptions(user_id, created_at desc);
alter table public.issue_subscriptions enable row level security;

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid references auth.users(id) on delete set null,
  issue_id uuid references public.civic_issues(id) on delete set null,
  channel text not null check (channel in ('in_app', 'email', 'push')),
  event_type text not null check (char_length(event_type) between 1 and 100),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed', 'suppressed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 100),
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists notification_outbox_dispatch_idx
  on public.notification_outbox(status, next_attempt_at, created_at) where status in ('pending', 'failed');
create index if not exists notification_outbox_recipient_created_idx
  on public.notification_outbox(recipient_id, created_at desc);
alter table public.notification_outbox enable row level security;

-- The Edge Function's service-role client is the only permitted writer/read path
-- for these tables until explicit user-facing RLS policies are added.
comment on table public.issue_reports is 'One row per citizen submission, even when linked to a shared canonical civic issue.';
comment on table public.issue_media is 'Storage object metadata. Bucket visibility and object access are managed separately.';
comment on table public.issue_assignments is 'Append-only assignment history; civic_issues.assigned_to remains the active projection during migration.';
comment on table public.ai_analysis_runs is 'Sanitized AI task audit. Never store secrets, raw image bytes, or private provider diagnostics here.';
comment on table public.ai_feedback is 'Staff-reviewed labels for offline model/provider quality evaluation.';
comment on table public.issue_subscriptions is 'Per-user issue status notification preferences.';
comment on table public.notification_outbox is 'Transactional notification queue; delivery requires an explicitly configured worker/provider.';


-- The deployed RPC previously counted every nearby duplicate as an upvote and
-- discarded the individual report/photo context. Replace it with an idempotent
-- version that preserves every submission, stores media metadata, and serializes
-- same-category matching to avoid concurrent duplicate tickets at demo scale.
create or replace function public.submit_civic_issue(
  p_reporter_id uuid,
  p_defect_type text,
  p_description text,
  p_lat double precision,
  p_lng double precision,
  p_landmark text default ''::text,
  p_zone text default 'unassigned'::text,
  p_priority_score smallint default 0,
  p_severity public.civic_issue_severity default 'LOW'::public.civic_issue_severity,
  p_confidence numeric default 0,
  p_before_damage_pct numeric default 0,
  p_before_image_path text default null::text,
  p_ai_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  point extensions.geography;
  found_issue public.civic_issues%rowtype;
  found_report public.issue_reports%rowtype;
  new_report public.issue_reports%rowtype;
  merged boolean := false;
  v_idempotency_key text := nullif(trim(coalesce(p_ai_metadata ->> 'submission_idempotency_key', '')), '');
  v_idempotency_subject text := nullif(trim(coalesce(p_ai_metadata ->> 'submission_idempotency_subject', '')), '');
  clean_ai_metadata jsonb := coalesce(p_ai_metadata, '{}'::jsonb);
  upload_content_type text := nullif(trim(coalesce(p_ai_metadata ->> 'upload_content_type', '')), '');
  upload_bucket_id text := nullif(trim(coalesce(p_ai_metadata ->> 'upload_bucket_id', '')), '');
  upload_size_bytes bigint := nullif(trim(coalesce(p_ai_metadata ->> 'upload_size_bytes', '')), '')::bigint;
  upload_visibility text := coalesce(nullif(trim(coalesce(p_ai_metadata ->> 'upload_visibility', '')), ''), 'public');
begin
  if p_defect_type not in ('pothole','garbage','sewage','streetlight','unknown') then
    raise exception 'Unsupported issue category';
  end if;
  if char_length(trim(coalesce(p_description,''))) not between 5 and 2000 then
    raise exception 'Description must be between 5 and 2000 characters';
  end if;
  if p_lat is null or p_lat < -90 or p_lat > 90 or p_lng is null or p_lng < -180 or p_lng > 180 then
    raise exception 'Invalid coordinates';
  end if;
  if upload_visibility not in ('private', 'public') then
    upload_visibility := 'private';
  end if;
  v_idempotency_subject := coalesce(idempotency_subject, p_reporter_id::text, 'anonymous');
  v_idempotency_key := coalesce(idempotency_key, gen_random_uuid()::text);
  if char_length(v_idempotency_subject) not between 1 and 160
     or char_length(v_idempotency_key) not between 8 and 160 then
    raise exception 'Invalid idempotency scope or key';
  end if;

  -- Same-category advisory locks prevent two concurrent submissions from both
  -- creating a new canonical ticket when a matching ticket is within 15 metres.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('civicpulse:submit:' || p_defect_type, 0)
  );

  select * into found_report
  from public.issue_reports r
  where r.idempotency_subject = v_idempotency_subject
    and r.idempotency_key = v_idempotency_key
  limit 1
  for update;

  if found_report.id is not null then
    select * into found_issue from public.civic_issues i where i.id = found_report.issue_id;
    if found_issue.id is null then
      raise exception 'Idempotent report exists but its canonical ticket is missing';
    end if;
    return jsonb_build_object(
      'merged', found_report.submission_status = 'merged',
      'idempotent_replay', true,
      'report_id', found_report.id,
      'ticket', (to_jsonb(found_issue) - 'location') ||
        jsonb_build_object('location', extensions.st_asgeojson(found_issue.location)::jsonb)
    );
  end if;

  point := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
  select * into found_issue
  from public.civic_issues i
  where i.status <> 'Resolved'
    and i.defect_type = p_defect_type
    and extensions.st_dwithin(i.location, point, 15)
  order by extensions.st_distance(i.location, point)
  limit 1
  for update;

  clean_ai_metadata := clean_ai_metadata
    - 'submission_idempotency_key'
    - 'submission_idempotency_subject'
    - 'upload_content_type'
    - 'upload_bucket_id'
    - 'upload_size_bytes'
    - 'upload_visibility';

  if found_issue.id is not null then
    update public.civic_issues
    set report_frequency = report_frequency + 1,
        duplicate_count = duplicate_count + 1
    where id = found_issue.id
    returning * into found_issue;
    merged := true;
  else
    insert into public.civic_issues(
      reporter_id, defect_type, description, priority_score, severity, location, zone, confidence,
      upvote_count, report_frequency, duplicate_count, before_damage_pct, before_image_path, ai_metadata, landmark
    )
    values(
      p_reporter_id,
      p_defect_type,
      trim(p_description),
      greatest(0, least(100, coalesce(p_priority_score, 0))),
      coalesce(p_severity, 'LOW'),
      point,
      left(coalesce(nullif(trim(p_zone), ''), 'unassigned'), 80),
      greatest(0, least(1, coalesce(p_confidence, 0))),
      1,
      1,
      0,
      greatest(0, least(100, coalesce(p_before_damage_pct, 0))),
      p_before_image_path,
      coalesce(clean_ai_metadata, '{}'::jsonb),
      left(coalesce(p_landmark, ''), 200)
    )
    returning * into found_issue;
  end if;

  insert into public.issue_reports(
    issue_id, reporter_id, defect_type, description, ai_metadata, ai_confidence, ai_priority_score,
    ai_severity, location, landmark, submission_status, idempotency_subject, idempotency_key
  )
  values(
    found_issue.id, p_reporter_id, p_defect_type, trim(p_description), coalesce(clean_ai_metadata, '{}'::jsonb),
    greatest(0, least(1, coalesce(p_confidence, 0))),
    greatest(0, least(100, coalesce(p_priority_score, 0))),
    coalesce(p_severity, 'LOW'),
    point,
    left(coalesce(p_landmark, ''), 200),
    case when merged then 'merged' else 'canonical' end,
    v_idempotency_subject,
    v_idempotency_key
  )
  returning * into new_report;

  if p_before_image_path is not null
     and upload_content_type in ('image/jpeg', 'image/png', 'image/webp')
     and upload_size_bytes between 1 and 8388608 then
    insert into public.issue_media(
      issue_id, report_id, uploaded_by, bucket_id, object_path, media_role, content_type,
      size_bytes, visibility, moderation_status
    )
    values(
      found_issue.id,
      new_report.id,
      p_reporter_id,
      coalesce(upload_bucket_id, 'civic-issue-images'),
      p_before_image_path,
      'report_photo',
      upload_content_type,
      upload_size_bytes,
      upload_visibility,
      case when upload_visibility = 'public' then 'approved' else 'pending' end
    )
    on conflict (bucket_id, object_path) do nothing;
  end if;

  if merged then
    insert into public.issue_events(issue_id, actor_id, event_type, note, metadata)
    values(
      found_issue.id, p_reporter_id, 'merged', 'Nearby report linked to this incident',
      jsonb_build_object('source', 'public_api', 'report_id', new_report.id)
    );
  else
    insert into public.issue_events(issue_id, actor_id, event_type, new_status, note, metadata)
    values(
      found_issue.id, p_reporter_id, 'created', found_issue.status, 'Issue reported',
      jsonb_build_object('source', 'public_api', 'report_id', new_report.id)
    );
  end if;

  return jsonb_build_object(
    'merged', merged,
    'idempotent_replay', false,
    'report_id', new_report.id,
    'ticket', (to_jsonb(found_issue) - 'location') ||
      jsonb_build_object('location', extensions.st_asgeojson(found_issue.location)::jsonb)
  );
end;
$function$;

-- The migration's new caller contract is still service-role only.
revoke all on function public.submit_civic_issue(uuid,text,text,double precision,double precision,text,text,smallint,public.civic_issue_severity,numeric,numeric,text,jsonb) from public, anon, authenticated;
grant execute on function public.submit_civic_issue(uuid,text,text,double precision,double precision,text,text,smallint,public.civic_issue_severity,numeric,numeric,text,jsonb) to service_role;
