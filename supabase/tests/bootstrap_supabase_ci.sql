-- Disposable CI-only Supabase compatibility scaffolding for migration syntax checks.
-- Do not run against a production database.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;

-- The PostGIS CI image pre-installs PostGIS in public. PostGIS 2.3+ is not
-- relocatable, so for this disposable database recreate it in the schema used
-- by the live Supabase project rather than attempting ALTER EXTENSION SET SCHEMA.
create schema if not exists extensions;
drop extension if exists postgis cascade;
create extension postgis with schema extensions;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create or replace function auth.uid()
returns uuid language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null
);
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.buckets, storage.objects to service_role;
grant select on storage.buckets, storage.objects to anon, authenticated;
