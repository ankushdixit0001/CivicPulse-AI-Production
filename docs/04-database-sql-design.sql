-- CivicPulse AI: database design reference
-- Assessment date: 2026-10-30
--
-- IMPORTANT:
-- 1. This is a DESIGN REFERENCE, not an applied migration.
-- 2. It is not safe to execute against the populated production database as a single script.
-- 3. First reconcile the live migration history with tracked files, take a backup, test against a
--    disposable Supabase branch/project, review RLS and confirm the public/private media decision.
-- 4. Core DDL below describes the intended current-state schema. Later sections contain proposed
--    hardening patches and optional vNext tables.
--
-- Platform prerequisites: Supabase-managed auth.users, auth.uid(), anon/authenticated/service_role,
-- PostGIS in the extensions schema, and pgcrypto. No secret values belong in SQL or source control.

-- =============================================================================
-- A. Fresh-schema logical DDL (reference only)
-- =============================================================================

create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

do $$ begin
  create type public.civic_issue_status as enum ('Pending', 'Assigned', 'In Progress', 'Resolved');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.civic_issue_severity as enum ('LOW', 'MEDIUM', 'CRITICAL');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.civic_user_role as enum ('resident', 'staff', 'admin');
exception when duplicate_object then null;
end $$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role public.civic_user_role not null default 'resident',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.civic_issues (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  defect_type text not null
    check (defect_type in ('pothole','garbage','sewage','streetlight','unknown')),
  description text not null check (char_length(description) between 5 and 2000),
  priority_score smallint not null default 0 check (priority_score between 0 and 100),
  severity public.civic_issue_severity not null default 'LOW',
  status public.civic_issue_status not null default 'Pending',
  location extensions.geography(point,4326) not null,
  zone text not null default 'unassigned' check (char_length(zone) between 1 and 80),
  landmark text not null default '' check (char_length(landmark) <= 200),
  confidence numeric(5,4) not null default 0 check (confidence between 0 and 1),
  -- Design correction: report_frequency counts report contributions; upvote_count counts votes only.
  upvote_count integer not null default 0 check (upvote_count >= 0),
  report_frequency integer not null default 1 check (report_frequency >= 1),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  before_damage_pct numeric(5,2) not null default 0 check (before_damage_pct between 0 and 100),
  after_damage_pct numeric(5,2) check (after_damage_pct between 0 and 100),
  before_image_path text,
  after_image_path text,
  ai_metadata jsonb not null default '{}'::jsonb,
  resolution_verified_at timestamptz,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.issue_events (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.civic_issues(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in (
    'created','merged','status_changed','assigned',
    'resolution_submitted','resolution_verified','resolved','commented',
    'reopened','escalated'
  )),
  old_status public.civic_issue_status,
  new_status public.civic_issue_status,
  note text check (note is null or char_length(note) <= 2000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.issue_comments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.civic_issues(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table public.issue_votes (
  issue_id uuid not null references public.civic_issues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (issue_id,user_id)
);

create table public.civic_api_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0)
);

-- Query indexes. Create only after checking the live catalogue and existing query plans.
create index if not exists civic_issues_status_created_idx
  on public.civic_issues(status,created_at desc);
create index if not exists civic_issues_zone_status_idx
  on public.civic_issues(zone,status);
create index if not exists civic_issues_priority_idx
  on public.civic_issues(priority_score desc);
create index if not exists civic_issues_reporter_idx
  on public.civic_issues(reporter_id,created_at desc);
create index if not exists civic_issues_location_gix
  on public.civic_issues using gist(location);
create index if not exists civic_issues_assigned_to_idx
  on public.civic_issues(assigned_to);
create index if not exists issue_events_issue_created_idx
  on public.issue_events(issue_id,created_at desc);
create index if not exists issue_events_actor_idx
  on public.issue_events(actor_id);
create index if not exists issue_comments_issue_created_idx
  on public.issue_comments(issue_id,created_at);
create index if not exists issue_comments_author_idx
  on public.issue_comments(author_id);
create index if not exists issue_votes_user_idx
  on public.issue_votes(user_id);

-- =============================================================================
-- B. Identity and timestamp helpers (fresh-schema design)
-- =============================================================================

create or replace function public.current_civic_role()
returns public.civic_user_role
language sql stable security invoker
set search_path = ''
as $$
  select coalesce(
    (select p.role from public.profiles p where p.id = (select auth.uid())),
    'resident'::public.civic_user_role
  )
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create or replace function public.create_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(id,display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email,''),'@',1)
    )
  )
  on conflict(id) do nothing;
  return new;
end
$$;

revoke all on function public.create_profile_for_user() from public, anon, authenticated;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

create trigger issues_touch_updated_at
before update on public.civic_issues
for each row execute function public.touch_updated_at();

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.create_profile_for_user();

-- =============================================================================
-- C. Row Level Security design
-- =============================================================================
-- Note: table grants and policies should be reviewed together. Edge Function server-role writes
-- bypass RLS; the handler must authenticate/authorize protected requests before using service role.

alter table public.profiles enable row level security;
alter table public.civic_issues enable row level security;
alter table public.issue_events enable row level security;
alter table public.issue_comments enable row level security;
alter table public.issue_votes enable row level security;
alter table public.civic_api_rate_limits enable row level security;

create policy "profiles_select_authenticated"
on public.profiles for select to authenticated using (true);

create policy "profiles_update_self_without_role_change"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id and role = public.current_civic_role());

create policy "issues_public_read"
on public.civic_issues for select to anon,authenticated using (true);

create policy "issues_insert_authenticated_self"
on public.civic_issues for insert to authenticated
with check ((select auth.uid()) = reporter_id);

create policy "issues_staff_update"
on public.civic_issues for update to authenticated
using (public.current_civic_role() in ('staff','admin'))
with check (public.current_civic_role() in ('staff','admin'));

create policy "events_read_authenticated"
on public.issue_events for select to authenticated using (true);

create policy "events_staff_append_self"
on public.issue_events for insert to authenticated
with check (
  (select auth.uid()) = actor_id
  and public.current_civic_role() in ('staff','admin')
);

create policy "comments_read_authenticated"
on public.issue_comments for select to authenticated using (true);

create policy "comments_insert_self"
on public.issue_comments for insert to authenticated
with check ((select auth.uid()) = author_id);

create policy "votes_read_authenticated"
on public.issue_votes for select to authenticated using (true);

create policy "votes_insert_self"
on public.issue_votes for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "votes_delete_self"
on public.issue_votes for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "rate_limits_service_role_only"
on public.civic_api_rate_limits for all to service_role
using (true) with check (true);

revoke all on public.civic_api_rate_limits from public,anon,authenticated;
grant all on public.civic_api_rate_limits to service_role;

-- Anonymous issue creation is intentionally routed through the authenticated server-side RPC,
-- not direct INSERT on civic_issues. Keep anon without direct insert privileges/policies.

-- =============================================================================
-- D. Proposed correctness patches — migrate only after review and a backup
-- =============================================================================

-- D1. Fix the confirmed event-type mismatch. Current Edge Function calls addEvent(...,'resolved',...).
-- The live check constraint excludes 'resolved'; add it so an audited resolution can be committed.
alter table public.issue_events
  drop constraint if exists issue_events_event_type_check;
alter table public.issue_events
  add constraint issue_events_event_type_check
  check (event_type in (
    'created','merged','status_changed','assigned',
    'resolution_submitted','resolution_verified','resolved','commented',
    'reopened','escalated'
  ));

-- D2. Correct vote counter semantics. Current production function recounts votes; duplicate
-- report merges also increment upvote_count. Separate report_frequency from vote count before
-- replacing the trigger. Atomic increments avoid a read-then-write race between concurrent voters.
create or replace function public.refresh_issue_vote_count()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.civic_issues
       set upvote_count = upvote_count + 1
     where id = new.issue_id;
    return new;
  else
    update public.civic_issues
       set upvote_count = greatest(0,upvote_count - 1)
     where id = old.issue_id;
    return old;
  end if;
end
$$;

-- D3. Recommended dedupe serialization pattern (illustrative fragment for submit_civic_issue).
-- A category-scoped transaction advisory lock closes the "no row exists to lock" race for an MVP.
-- At higher volume replace it with a tested spatial-cell/neighbor-cell lock scheme.
-- Place this immediately before the ST_DWithin lookup, inside the same transaction:
--
-- perform pg_advisory_xact_lock(
--   pg_catalog.hashtextextended('civic-dedupe:' || p_defect_type, 0)
-- );
--
-- Retain the GiST index, ST_DWithin geography predicate, nearest-candidate rule and row lock.
-- Add an idempotency key for retry safety before expanding anonymous intake.

-- D4. Media privacy is a product decision, not a blind schema migration.
-- Current bucket is public and public URLs are stored in ai_metadata. For private-by-default:
-- (i) change the bucket to public=false only after UI/API can create short-lived signed URLs;
-- (ii) remove public object SELECT policy; (iii) add policies for authorized staff and owner;
-- (iv) migrate old public URLs and confirm client rendering; (v) communicate retention and deletion.
-- Do not execute this patch until the product owner approves the privacy/public-display model.
--
-- update storage.buckets
--    set public = false
--  where id = 'civic-issue-images';
--
-- drop policy if exists "public may read civic issue images" on storage.objects;
-- Create scoped SELECT policies for staff and reporter only; use short-lived signed URLs for
-- approved public/anonymous ticket display. Never expose the service-role credential.

-- =============================================================================
-- E. Optional normalized vNext tables (not live; only if requirements justify)
-- =============================================================================

create table public.issue_reports (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.civic_issues(id) on delete cascade,
  reporter_id uuid references auth.users(id) on delete set null,
  idempotency_key text not null unique,
  description text not null check (char_length(description) between 5 and 2000),
  location extensions.geography(point,4326) not null,
  created_at timestamptz not null default now()
);

create table public.issue_attachments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.civic_issues(id) on delete cascade,
  report_id uuid references public.issue_reports(id) on delete set null,
  evidence_kind text not null check (evidence_kind in ('report_before','repair_after','redacted_public')),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  size_bytes bigint not null check (size_bytes between 1 and 8388608),
  sha256 text,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.issue_ai_analyses (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.civic_issues(id) on delete cascade,
  attachment_id uuid references public.issue_attachments(id) on delete set null,
  analysis_kind text not null check (analysis_kind in ('triage','repair_verification','chat_assist')),
  provider text not null,
  model text not null,
  prompt_version text not null,
  status text not null check (status in ('success','partial','unavailable','rejected')),
  confidence numeric(5,4) check (confidence between 0 and 1),
  result jsonb not null default '{}'::jsonb,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  created_at timestamptz not null default now()
);

create index issue_reports_issue_created_idx
  on public.issue_reports(issue_id,created_at desc);
create index issue_attachments_issue_created_idx
  on public.issue_attachments(issue_id,created_at);
create index issue_ai_analyses_issue_created_idx
  on public.issue_ai_analyses(issue_id,created_at desc);

-- Enable RLS and define narrowly scoped policies for every vNext table before exposing any of them
-- through PostgREST or adding them to a realtime publication.
