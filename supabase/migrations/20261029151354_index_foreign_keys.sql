-- Query- and foreign-key-supporting indexes from the deployed schema snapshot.
create index if not exists civic_issues_status_created_idx on public.civic_issues(status, created_at desc);
create index if not exists civic_issues_zone_status_idx on public.civic_issues(zone, status);
create index if not exists civic_issues_priority_idx on public.civic_issues(priority_score desc);
create index if not exists civic_issues_reporter_idx on public.civic_issues(reporter_id, created_at desc);
create index if not exists civic_issues_location_gix on public.civic_issues using gist(location);
create index if not exists civic_issues_assigned_to_idx on public.civic_issues(assigned_to);
create index if not exists issue_comments_issue_created_idx on public.issue_comments(issue_id, created_at);
create index if not exists issue_comments_author_idx on public.issue_comments(author_id);
create index if not exists issue_events_issue_created_idx on public.issue_events(issue_id, created_at desc);
create index if not exists issue_events_actor_idx on public.issue_events(actor_id);
create index if not exists issue_votes_user_idx on public.issue_votes(user_id);
