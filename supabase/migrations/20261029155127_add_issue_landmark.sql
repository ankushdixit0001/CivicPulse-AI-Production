alter table public.civic_issues
  add column if not exists landmark text not null default '';
alter table public.civic_issues
  drop constraint if exists civic_issues_landmark_check;
alter table public.civic_issues
  add constraint civic_issues_landmark_check check (char_length(landmark) <= 200);
