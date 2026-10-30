# 03 — Database ERD and Data Dictionary

**Assessment date:** 2026-10-30  
**Database:** Supabase Postgres 17.11 with PostGIS  
**Status:** First diagram is the live/current logical model. Extension model is proposed, not deployed.

## 1. Current logical ERD

~~~mermaid
erDiagram
  AUTH_USERS ||--o| PROFILES : "has profile"
  AUTH_USERS ||--o{ CIVIC_ISSUES : "reports (nullable for anonymous)"
  PROFILES ||--o{ CIVIC_ISSUES : "assigned_to"
  CIVIC_ISSUES ||--o{ ISSUE_EVENTS : "has history"
  AUTH_USERS o|--o{ ISSUE_EVENTS : "acts"
  CIVIC_ISSUES ||--o{ ISSUE_COMMENTS : "has comments"
  AUTH_USERS ||--o{ ISSUE_COMMENTS : "authors"
  CIVIC_ISSUES ||--o{ ISSUE_VOTES : "receives votes"
  AUTH_USERS ||--o{ ISSUE_VOTES : "casts votes"

  AUTH_USERS {
    uuid id PK
    text email
    timestamptz created_at
  }
  PROFILES {
    uuid id PK,FK
    text display_name
    civic_user_role role
    timestamptz created_at
    timestamptz updated_at
  }
  CIVIC_ISSUES {
    uuid id PK
    uuid reporter_id FK "nullable"
    text defect_type
    text description
    smallint priority_score
    civic_issue_severity severity
    civic_issue_status status
    geography_point location
    text zone
    text landmark
    numeric confidence
    integer upvote_count
    integer report_frequency
    integer duplicate_count
    numeric before_damage_pct
    numeric after_damage_pct
    text before_image_path
    text after_image_path
    jsonb ai_metadata
    uuid assigned_to FK
    timestamptz resolution_verified_at
    timestamptz created_at
    timestamptz updated_at
    timestamptz resolved_at
  }
  ISSUE_EVENTS {
    uuid id PK
    uuid issue_id FK
    uuid actor_id FK "nullable"
    text event_type
    civic_issue_status old_status
    civic_issue_status new_status
    text note
    jsonb metadata
    timestamptz created_at
  }
  ISSUE_COMMENTS {
    uuid id PK
    uuid issue_id FK
    uuid author_id FK
    text body
    timestamptz created_at
  }
  ISSUE_VOTES {
    uuid issue_id PK,FK
    uuid user_id PK,FK
    timestamptz created_at
  }
  CIVIC_API_RATE_LIMITS {
    text bucket_key PK
    timestamptz window_started_at
    integer request_count
  }
~~~

auth.users is Supabase-managed and is not owned by the application schema. civic_api_rate_limits is a technical table; it is intentionally not related by FK to users because it also limits anonymous IP identities.

## 2. Entity descriptions

### 2.1 profiles

One-to-one extension of auth.users. Stores a display name and database-controlled role (resident, staff, admin). A trigger creates a resident profile after Auth signup. A user's own profile update must not allow role changes. Staff/admin promotion is a privileged administrative operation and should be separately audited.

### 2.2 civic_issues

Canonical ticket/incident row. Current columns hold category, issue narrative, PostGIS point, zone/landmark, priority and severity, image references, AI metadata, assignment, workflow timestamps and report counters. reporter_id is nullable to support anonymous reporting. location is geography(Point,4326), with longitude/latitude semantics.

Current check ranges:
- Category: pothole, garbage, sewage, streetlight, unknown.
- Description: 5–2000 characters.
- priority_score: 0–100.
- confidence: 0–1.
- before_damage_pct and after_damage_pct: 0–100.
- zone: 1–80 characters; default currently central in table DDL, while public API defaults new reports to unassigned.

Current counter semantics need correction: duplicate reporting currently increments both upvote_count and report_frequency, while the votes trigger derives upvote_count from issue_votes. Separate report frequency from explicit votes and make the meaning of each counter stable.

### 2.3 issue_events

Append-oriented lifecycle history with issue, optional actor, event type, optional old/new status, note, metadata and timestamp. Current check constraint excludes resolved, while the Edge Function attempts that value on confirmation. It also has no event types for explicit assignment target change, reopen, escalation or privacy review. Add event types only with the corresponding lifecycle decision.

### 2.4 issue_comments

User-authored comments on an issue. The FK to auth.users is required; anonymous comments are not supported by the current policy. Body is 1–2000 characters.

### 2.5 issue_votes

Join table with composite PK (issue_id,user_id); this enforces at most one active vote per user per issue. Insert/delete policies require the authenticated identity to match user_id.

### 2.6 civic_api_rate_limits

Service-role-only bucket key, fixed-window start and request count. The Edge Function hashes a derived identity before using the key. Old buckets require a scheduled cleanup policy; trusted client IP extraction also needs review.

## 3. Main relationships and cardinality

- One Auth user has zero or one profile.
- One Auth user may report zero or many issues. Anonymous issues have no reporter_id.
- One profile may be assigned many issues; each issue has zero or one current assignee.
- One issue has many events, comments and votes.
- One user can create many comments and cast one vote per issue.
- An event has one issue and zero or one actor (actor can be null after user deletion).
- Rate-limit rows are independent keyed counters, with no FK to the authenticated user table.

## 4. Index design observed

| Index | Columns / type | Purpose |
|---|---|---|
| civic_issues_pkey | btree id | Primary lookup |
| civic_issues_status_created_idx | btree status, created_at DESC | Dispatch board |
| civic_issues_zone_status_idx | btree zone, status | Zone/status filter |
| civic_issues_priority_idx | btree priority_score DESC | Priority sort |
| civic_issues_reporter_idx | btree reporter_id, created_at DESC | Resident history |
| civic_issues_location_gix | GiST location | PostGIS proximity |
| civic_issues_assigned_to_idx | btree assigned_to | Staff queue |
| issue_events_issue_created_idx | btree issue_id, created_at DESC | Ticket timeline |
| issue_events_actor_idx | btree actor_id | Actor audit lookup |
| issue_comments_issue_created_idx | btree issue_id, created_at | Thread ordering |
| issue_comments_author_idx | btree author_id | User comment lookup |
| issue_votes_user_idx | btree user_id | User vote history |
| issue_votes_pkey | btree issue_id,user_id | Unique vote / issue lookup |
| civic_api_rate_limits_pkey | btree bucket_key | Counter upsert |

Supabase Performance Advisor flagged eight non-primary indexes as unused in the small current sample. Keep them until query plans and production-like traffic justify changes.

## 5. Proposed normalized extension model

Current JSONB metadata and two image columns are sufficient for an early prototype, but they become hard to audit as evidence, AI retries and model versions grow. Proposed future entities:

~~~mermaid
erDiagram
  CIVIC_ISSUES ||--o{ ISSUE_REPORTS : "contributions"
  AUTH_USERS o|--o{ ISSUE_REPORTS : "reporter"
  ISSUE_REPORTS ||--o{ ISSUE_ATTACHMENTS : "evidence"
  CIVIC_ISSUES ||--o{ ISSUE_ATTACHMENTS : "canonical media"
  CIVIC_ISSUES ||--o{ ISSUE_AI_ANALYSES : "AI attempts"

  ISSUE_REPORTS {
    uuid id PK
    uuid issue_id FK
    uuid reporter_id FK
    text idempotency_key UK
    text description
    geography_point location
    timestamptz created_at
  }
  ISSUE_ATTACHMENTS {
    uuid id PK
    uuid issue_id FK
    uuid report_id FK
    text evidence_kind
    text storage_path UK
    text mime_type
    bigint size_bytes
    text sha256
    uuid uploaded_by FK
    timestamptz created_at
  }
  ISSUE_AI_ANALYSES {
    uuid id PK
    uuid issue_id FK
    uuid attachment_id FK
    text analysis_kind
    text provider
    text model
    text prompt_version
    text status
    numeric confidence
    jsonb result
    integer latency_ms
    timestamptz created_at
  }
~~~

| Extension | Benefit | Introduce when |
|---|---|---|
| issue_reports | Preserves each resident contribution separately when multiple reports merge into one canonical incident; enables idempotency | Before expanding public reporting or needing report-level moderation |
| issue_attachments | Normalizes multi-photo, before/after, redacted/public rendition, hashes and retention metadata | When multiple photos or privacy variants are required |
| issue_ai_analyses | Immutable AI attempts with provider/model/prompt version, status, scores and latency | Before prompt/model experimentation, audit or quality measurement |

Do not build these extension tables until product requirements, retention and migration mapping are approved. Do not overwrite current issue image fields until a backfill and rollback strategy has been designed.

## 6. Data-classification recommendation

| Data | Suggested classification | Exposure |
|---|---|---|
| Issue category/status/priority/approximate zone | Public after moderation | Public API projection |
| Exact location | Sensitive operational data | Public only if owner approves; consider coordinate precision reduction |
| Original report / repair photo | Potentially personal | Private by default; signed access |
| Description / landmark | Potentially identifying | Moderate / redact personal details |
| Auth email / profile | Personal | Own user and trusted staff only |
| Staff assignment and audit metadata | Internal | Staff/admin only |
| AI model raw output / prompt metadata | Internal operational data | Staff only; public UI receives sanitized summary |
| Rate-limit identity digest | Security telemetry | Service role only, time-limited retention |
