# CivicPulse AI — Database Design

**Status:** Target model and compatibility notes. Proposal only; not applied to Supabase. The live baseline was inspected on 2026-10-29. Existing tables are preserved.

## 1. Principles

- Use relational integrity for civic workflow and PostGIS geography for duplicate detection.
- UUID primary keys, UTC timestamptz, bounded text, and constraints for category/status/score values.
- Keep image bytes in Storage; database stores bucket/path, MIME type, size, checksum, dimensions and visibility.
- AI output is versioned evidence, not canonical truth. Store provider/model/status separately from resident-entered fields.
- RLS is default-deny for private features. Server-side service-role operations must independently authorize every action.
- Do not persist API keys, raw tokens, full prompts or raw IP addresses longer than necessary.

## 2. Existing live schema

The following tables and important columns were observed. This is not a full DDL export.

### profiles

| Column | Type | Meaning |
|---|---|---|
| id | uuid PK, FK auth.users.id | canonical user ID |
| display_name | nullable text | public display name |
| role | civic_user_role | resident (default), staff, admin |
| created_at, updated_at | timestamptz | lifecycle |

Role changes must be restricted to a server-side admin operation. A user must not elevate their role through profile update.

### civic_issues

| Column | Type / constraint | Meaning |
|---|---|---|
| id | uuid PK | issue ID |
| reporter_id | nullable uuid FK auth.users | nullable for anonymous intake if allowed |
| defect_type | text enum/check | pothole, garbage, sewage, streetlight, unknown |
| description | text 5–2000 chars | resident description |
| priority_score | smallint 0–100 | computed server-side |
| severity | civic_issue_severity | LOW, MEDIUM, CRITICAL |
| status | civic_issue_status | Pending, Assigned, In Progress, Resolved |
| location | geography | required WGS84 point |
| zone | text | bounded zone label, currently defaults to central |
| landmark | text up to 200 chars | nearby landmark |
| confidence | numeric 0–1 | AI confidence estimate |
| upvote_count | integer >= 0 | denormalized vote count |
| report_frequency | integer >= 1 | total/merged report frequency |
| duplicate_count | integer >= 0 | merged duplicate counter |
| before_damage_pct | numeric 0–100 | first-image estimate |
| after_damage_pct | nullable numeric 0–100 | after-image estimate |
| before_image_path | nullable text | current original object path |
| after_image_path | nullable text | current repair object path |
| ai_metadata | jsonb | current analysis/verification metadata |
| resolution_verified_at | nullable timestamptz | verification time |
| assigned_to | nullable uuid FK profiles.id | current staff assignment |
| created_at, updated_at | timestamptz | lifecycle |
| resolved_at | nullable timestamptz | final resolution timestamp |

Current indexes observed: primary key; GiST on location; priority score descending; status plus created_at; zone plus status; reporter_id plus created_at descending; and assigned_to.

### Supporting tables

- **issue_events:** issue_id, actor_id, event_type, old_status/new_status, note, metadata JSONB, created_at. Append-only timeline/audit events.
- **issue_comments:** issue_id, author_id, body (1–2000 characters), created_at.
- **issue_votes:** composite primary key on issue_id plus user_id; one vote per user/issue.
- **civic_api_rate_limits:** bucket_key primary key, window_started_at, request_count; service-role managed.
- **profiles:** role-bearing extension of auth.users.

Foreign keys connect issues to reporter/assigned staff and child records to issue/auth users. RLS is enabled on all observed public tables.

## 3. Entity relationship diagram

~~~mermaid
erDiagram
  AUTH_USERS ||--o| PROFILES : has
  AUTH_USERS o|--o{ CIVIC_ISSUES : reports
  PROFILES o|--o{ CIVIC_ISSUES : assigned
  CIVIC_ISSUES ||--o{ ISSUE_EVENTS : records
  CIVIC_ISSUES ||--o{ ISSUE_COMMENTS : has
  CIVIC_ISSUES ||--o{ ISSUE_VOTES : receives
  CIVIC_ISSUES ||--o{ ISSUE_MEDIA : owns
  CIVIC_ISSUES ||--o{ AI_ANALYSIS_RUNS : evaluated
  CIVIC_ISSUES ||--o{ ISSUE_ASSIGNMENTS : assigned_over_time
  AUTH_USERS ||--o{ NOTIFICATIONS : receives
  CIVIC_ISSUES ||--o{ NOTIFICATIONS : references
  JURISDICTIONS ||--o{ CIVIC_ISSUES : contains
  AUTH_USERS ||--o{ SAVED_SEARCHES : saves
~~~

AUTH_USERS is managed by Supabase Auth and must not be recreated by project migrations.

## 4. Proposed additive tables

Add a table only when the corresponding feature is implemented and tested.

### issue_media — recommended next

Purpose: support multiple evidence files per issue without adding a separate column for every image type.

Fields: id UUID primary key; issue_id FK civic_issues; uploaded_by nullable FK auth.users; media_kind constrained to report, repair_before, repair_after, supporting or moderation; bucket_id; object_path; MIME type constrained to JPEG/PNG/WebP; byte_size between 1 byte and 8 MB; optional SHA-256, width and height; visibility constrained to public/staff/owner; created_at. Add a unique constraint on bucket_id plus object_path and indexes by issue/time and uploader/time.

Keep current before_image_path and after_image_path temporarily. Backfill and deprecate only in a later release.

### ai_analysis_runs — provider audit and reproducibility

Fields: id; nullable issue_id; nullable requested_by; task_type constrained to classify_issue, chat, verify_repair or summarize; status constrained to success, partial, unavailable or failed; provider; model; provider_request_id; latency_ms; input_media_id; output_schema_version; result JSONB; error_code; created_at.

Never store secret values. Minimize raw user text/image retention and do not store raw prompts by default. Restrict detailed records to staff/admin; residents receive sanitized output. Index by task/status/time and issue/time.

### issue_assignments — assignment history

Fields: id; issue_id; assigned_to; assigned_by; assignment_status constrained to active/released/completed; note; created_at; ended_at. Enforce at most one active assignment per issue with a partial unique index or transactional RPC. Keep civic_issues.assigned_to as current snapshot for board queries.

### jurisdictions and staff_jurisdictions — ward/zone boundaries

jurisdictions: id, name, unique code, optional geography MultiPolygon in SRID 4326, active, timestamps. Add GiST index for boundary. staff_jurisdictions links staff_id to jurisdiction_id through a composite primary key. Boundaries must use validated municipal data.

### notifications and notification_preferences

notifications fields: id, recipient_id, nullable issue_id, channel (in_app/email/push), event_key, title, body, delivery_status (pending/sent/failed/suppressed), attempts, next_attempt_at, sent_at, provider_message_id, safe_error_code, created_at.

Unique recipient + event key + channel for idempotency. Index by recipient/time and delivery status/next attempt.

notification_preferences: user_id primary key, in_app_enabled, email_enabled, push_enabled, updated_at. Do not assume consent from account existence.

### notification_outbox — reliable asynchronous delivery

Fields: id; unique event_key; event_type; sanitized payload JSONB; status; attempts; next_attempt_at; locked_at; sent_at; safe_error_code; created_at.

The issue transaction writes an audit event and outbox row together. A worker claims rows with SKIP LOCKED, bounded retries and exponential backoff. Never send email synchronously during report creation.

### saved_searches — optional

Fields: id, user_id, name, strictly validated allowlisted filters JSONB, timestamps. RLS limits rows to owner/admin.

### moderation_flags — optional

Fields: id, nullable issue_id, nullable submitted_by, reason enum, bounded details, state (open/reviewing/closed), reviewed_by, resolution_note, timestamps. Review is staff/admin only.

### idempotency_keys — recommended for report submission

Fields: scope, key, subject_id, request_hash, response_status, response_body JSONB, created_at, expires_at. Unique scope + key. Store only the minimum replay-safe result and expire records. Reusing a key with a different request hash returns conflict.

### sla_policies — optional

Fields: id, nullable jurisdiction_id, nullable defect_type/severity, first_response_minutes, resolution_target_minutes, active, timestamps. SLA breaches generate events/notifications rather than silently rewriting issue status.

## 5. Index and query strategy

- Use PostGIS ST_DWithin on location, point and radius with the existing GiST index for duplicate/nearby search.
- Do not calculate distance across every issue in JavaScript.
- Add a defect_type/status/created_at index only if query plans demonstrate need.
- Use bounded pagination and narrow select lists.
- Keep events/media append-oriented. Corrections use compensating events.
- The current ai_metadata JSONB supports compatibility; normalize new runs into ai_analysis_runs when that feature is built.
- Denormalized counts require atomic maintenance, never browser-provided values.
- Review representative EXPLAIN plans before adding indexes; each index imposes write cost.

## 6. RLS matrix

| Data | Visitor | Resident | Staff | Admin |
|---|---|---|---|---|
| Public issue fields | Read | Read | Read | Read |
| Own profile | None | Read/update safe fields | Read/update safe fields | Manage allowed fields |
| Role changes | None | None | None | Restricted admin operation |
| Comments | Public-safe or auth-only per configured policy | Add as self | Add as self | Moderate |
| Votes | Public counts | Toggle own | Toggle own | Toggle own |
| Events | Public-safe timeline | Public-safe timeline | Authorized detail | Authorized detail |
| AI internals/assignments | None | None | Allowed by role | Allowed |
| Media | By visibility | Own + public | Staff evidence | Admin |
| Rate limits/outbox | None | None | None | Restricted operator only |

Use auth.uid() for ownership and a safe role helper such as current_civic_role(). Role helpers must not be user-writable. Audit SECURITY DEFINER search paths and grants. Edge Functions using service role bypass RLS, so they must independently authorize actions.

## 7. Compatibility caveats

- Production currently has before_image_path and after_image_path; normalized issue_media is proposed, not live.
- The civic-issue-images bucket is documented as public. Confirm the privacy decision before changing it.
- Persisted statuses are title-cased while defect categories are lowercase. Normalize API inputs without renaming enums abruptly.
- Existing spatial/workflow indexes must not be recreated blindly.
- The proposed schema is not a migration plan by itself: each table needs RLS, grants, owner checks and tests before applying.
