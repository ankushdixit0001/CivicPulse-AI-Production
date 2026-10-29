-- Keep the Supabase schema aligned with the report form's optional landmark field.
alter table public.civic_issues
  add column if not exists landmark text not null default ''
  check (char_length(landmark) <= 200);
