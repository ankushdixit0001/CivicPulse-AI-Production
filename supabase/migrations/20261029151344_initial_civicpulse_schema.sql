-- Reconstructed baseline for the already-provisioned CivicPulse schema.
-- Source: live Supabase catalog snapshot on 2026-10-30. This file was not present
-- in the Git repository even though its version was already recorded by Supabase.
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

do $$ begin
  create type public.civic_user_role as enum ('resident', 'staff', 'admin');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.civic_issue_status as enum ('Pending', 'Assigned', 'In Progress', 'Resolved');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.civic_issue_severity as enum ('LOW', 'MEDIUM', 'CRITICAL');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role public.civic_user_role not null default 'resident',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.civic_issues (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  defect_type text not null check (defect_type in ('pothole', 'garbage', 'sewage', 'streetlight', 'unknown')),
  description text not null check (char_length(description) between 5 and 2000),
  priority_score smallint not null default 0 check (priority_score between 0 and 100),
  severity public.civic_issue_severity not null default 'LOW',
  status public.civic_issue_status not null default 'Pending',
  location extensions.geography(Point, 4326) not null,
  zone text not null default 'central' check (char_length(zone) between 1 and 80),
  confidence numeric(5,4) not null default 0 check (confidence between 0 and 1),
  upvote_count integer not null default 1 check (upvote_count >= 0),
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

create table if not exists public.issue_events (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.civic_issues(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('created', 'merged', 'status_changed', 'assigned', 'resolution_submitted', 'resolution_verified', 'commented')),
  old_status public.civic_issue_status,
  new_status public.civic_issue_status,
  note text check (note is null or char_length(note) <= 2000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.issue_comments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.civic_issues(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.issue_votes (
  issue_id uuid not null references public.civic_issues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (issue_id, user_id)
);

create or replace function public.current_civic_role()
returns public.civic_user_role
language sql stable
set search_path = ''
as $function$
  select coalesce(
    (select p.role from public.profiles p where p.id = (select auth.uid())),
    'resident'::public.civic_user_role
  )
$function$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at = now();
  return new;
end
$function$;

create or replace function public.create_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, ''), '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end
$function$;

create or replace function public.refresh_issue_vote_count()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  update public.civic_issues
  set upvote_count = (
    select count(*) from public.issue_votes v
    where v.issue_id = coalesce(new.issue_id, old.issue_id)
  )
  where id = coalesce(new.issue_id, old.issue_id);
  return coalesce(new, old);
end
$function$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists issues_touch_updated_at on public.civic_issues;
create trigger issues_touch_updated_at before update on public.civic_issues
for each row execute function public.touch_updated_at();

drop trigger if exists issue_votes_count_after_insert on public.issue_votes;
create trigger issue_votes_count_after_insert after insert on public.issue_votes
for each row execute function public.refresh_issue_vote_count();

drop trigger if exists issue_votes_count_after_delete on public.issue_votes;
create trigger issue_votes_count_after_delete after delete on public.issue_votes
for each row execute function public.refresh_issue_vote_count();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.create_profile_for_user();

alter table public.profiles enable row level security;
alter table public.civic_issues enable row level security;
alter table public.issue_events enable row level security;
alter table public.issue_comments enable row level security;
alter table public.issue_votes enable row level security;

drop policy if exists "users may update own profile" on public.profiles;
create policy "users may update own profile" on public.profiles
for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id and role = public.current_civic_role());

drop policy if exists "profiles readable to signed-in users" on public.profiles;
create policy "profiles readable to signed-in users" on public.profiles
for select to authenticated using (true);

drop policy if exists "public may read civic issues" on public.civic_issues;
create policy "public may read civic issues" on public.civic_issues
for select to anon, authenticated using (true);

drop policy if exists "staff may update issue workflow" on public.civic_issues;
create policy "staff may update issue workflow" on public.civic_issues
for update to authenticated
using (public.current_civic_role() in ('staff', 'admin'))
with check (public.current_civic_role() in ('staff', 'admin'));

drop policy if exists "residents may submit own reports" on public.civic_issues;
create policy "residents may submit own reports" on public.civic_issues
for insert to authenticated with check ((select auth.uid()) = reporter_id);

drop policy if exists "issue events readable by signed-in users" on public.issue_events;
create policy "issue events readable by signed-in users" on public.issue_events
for select to authenticated using (true);

drop policy if exists "issue comments readable by signed-in users" on public.issue_comments;
create policy "issue comments readable by signed-in users" on public.issue_comments
for select to authenticated using (true);

drop policy if exists "users may add comments" on public.issue_comments;
create policy "users may add comments" on public.issue_comments
for insert to authenticated with check ((select auth.uid()) = author_id);

drop policy if exists "votes readable to signed-in users" on public.issue_votes;
create policy "votes readable to signed-in users" on public.issue_votes
for select to authenticated using (true);

drop policy if exists "users may vote as themselves" on public.issue_votes;
create policy "users may vote as themselves" on public.issue_votes
for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "users may remove own votes" on public.issue_votes;
create policy "users may remove own votes" on public.issue_votes
for delete to authenticated using ((select auth.uid()) = user_id);
