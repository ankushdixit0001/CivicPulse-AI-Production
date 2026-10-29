-- CivicPulse AI: issue reporting, workflow, and audit tables.
-- Apply to the dedicated CivicPulse Supabase project only.
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create type public.civic_issue_status as enum ('Pending', 'Assigned', 'In Progress', 'Resolved');
create type public.civic_issue_severity as enum ('LOW', 'MEDIUM', 'CRITICAL');
create type public.civic_user_role as enum ('resident', 'staff', 'admin');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role public.civic_user_role not null default 'resident',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.civic_issues (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete restrict,
  defect_type text not null check (defect_type in ('pothole','garbage','sewage','streetlight','unknown')),
  description text not null check (char_length(description) between 5 and 2000),
  priority_score smallint not null default 0 check (priority_score between 0 and 100),
  severity public.civic_issue_severity not null default 'LOW',
  status public.civic_issue_status not null default 'Pending',
  location extensions.geography(point, 4326) not null,
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
create index civic_issues_status_created_idx on public.civic_issues(status, created_at desc);
create index civic_issues_zone_status_idx on public.civic_issues(zone, status);
create index civic_issues_priority_idx on public.civic_issues(priority_score desc);
create index civic_issues_reporter_idx on public.civic_issues(reporter_id, created_at desc);
create index civic_issues_location_gix on public.civic_issues using gist(location);
create index civic_issues_assigned_to_idx on public.civic_issues(assigned_to);

create table public.issue_events (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.civic_issues(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('created','merged','status_changed','assigned','resolution_submitted','resolution_verified','commented')),
  old_status public.civic_issue_status,
  new_status public.civic_issue_status,
  note text check (note is null or char_length(note) <= 2000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index issue_events_issue_created_idx on public.issue_events(issue_id, created_at desc);
create index issue_events_actor_idx on public.issue_events(actor_id);

create table public.issue_comments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.civic_issues(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index issue_comments_issue_created_idx on public.issue_comments(issue_id, created_at);
create index issue_comments_author_idx on public.issue_comments(author_id);

create table public.issue_votes (
  issue_id uuid not null references public.civic_issues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (issue_id, user_id)
);
create index issue_votes_user_idx on public.issue_votes(user_id);

create or replace function public.current_civic_role()
returns public.civic_user_role
language sql stable security invoker
set search_path = ''
as $$
  select coalesce((select p.role from public.profiles p where p.id = (select auth.uid())), 'resident'::public.civic_user_role)
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end
$$;
create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();
create trigger issues_touch_updated_at before update on public.civic_issues
for each row execute function public.touch_updated_at();

create or replace function public.create_profile_for_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1)))
  on conflict (id) do nothing;
  return new;
end
$$;
revoke all on function public.create_profile_for_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.create_profile_for_user();

alter table public.profiles enable row level security;
alter table public.civic_issues enable row level security;
alter table public.issue_events enable row level security;
alter table public.issue_comments enable row level security;
alter table public.issue_votes enable row level security;

create policy "profiles readable to signed-in users" on public.profiles
for select to authenticated using (true);
create policy "users may update own profile" on public.profiles
for update to authenticated using ((select auth.uid()) = id)
with check ((select auth.uid()) = id and role = public.current_civic_role());
create policy "authenticated users may read civic issues" on public.civic_issues
for select to authenticated using (true);
create policy "residents may submit own reports" on public.civic_issues
for insert to authenticated with check ((select auth.uid()) = reporter_id);
create policy "staff may update issue workflow" on public.civic_issues
for update to authenticated using (public.current_civic_role() in ('staff','admin'))
with check (public.current_civic_role() in ('staff','admin'));
create policy "issue events readable by signed-in users" on public.issue_events
for select to authenticated using (true);
create policy "issue event actor creates events" on public.issue_events
for insert to authenticated with check ((select auth.uid()) = actor_id);
create policy "issue comments readable by signed-in users" on public.issue_comments
for select to authenticated using (true);
create policy "users may add comments" on public.issue_comments
for insert to authenticated with check ((select auth.uid()) = author_id);
create policy "votes readable by signed-in users" on public.issue_votes
for select to authenticated using (true);
create policy "users may vote as themselves" on public.issue_votes
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "users may remove own votes" on public.issue_votes
for delete to authenticated using ((select auth.uid()) = user_id);

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.civic_issues to authenticated;
grant select, insert on public.issue_events to authenticated;
grant select, insert on public.issue_comments to authenticated;
grant select, insert, delete on public.issue_votes to authenticated;
