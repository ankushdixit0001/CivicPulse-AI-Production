# CivicPulse AI — Low-Level Design (LLD)

**Status:** Target implementation contract, based on code and schema inspection. This is not yet proof that every route/provider has passed end-to-end testing.

## 1. Code modules

### Frontend — frontend-app

| Module | Responsibility |
|---|---|
| Router/App | Landing, report and command center routes; never acts as authorization |
| Auth client | Supabase login/signup/session refresh/logout |
| CivicPulseApiClient | Central base URL, bearer token, JSON/multipart, request ID, timeout, typed errors |
| ReportForm | Category/description, GPS/manual point, landmark, image preview and upload |
| ImagePreparation | Resize/compress, EXIF handling, size checks, object URL lifecycle |
| IssueMap / IssueList | Public map/list, filters, pagination and issue details |
| IssueDetail | Status, comments, votes, report history and evidence |
| CommandCenter | Staff queue, assignment/status actions, repair review and analytics |
| AIHealthPanel | Separate chat, image-analysis and repair-verification state |
| HelpAssistant | Question + explicitly allowed context; never claims to modify an issue unless an authorized API call succeeded |

Frontend rules: no service-role or provider key, no trusted role from local storage, no fake AI output, no arbitrary database writes, and no success UI before the server confirms success.

### CivicPulse API — Supabase Edge Function

Keep one deployable Edge Function initially, but define focused internal operations:

- `authenticateUser(request)` — validates Supabase access token using Auth.
- `authorizeRole(userId, allowedRoles)` — checks role from canonical `profiles` data.
- `validateReport(formData)` — validates enum, text bounds, coordinates, file signature and size.
- `enforceRateLimit(subject, action)` — database-backed account/IP bucket; avoid persisting raw IP beyond the security need.
- `storeIssueImage(file, issueId, variant)` — stores evidence and returns a storage path.
- `analyzePhoto(file, category)` — invokes internal AI service; returns explicit unavailable/partial state on failure.
- `findPotentialDuplicates(category, point, radiusMeters)` — uses indexed PostGIS.
- `createOrMergeIssue(data, idempotencyKey)` — atomic create-or-merge operation.
- `transitionIssue(issueId, actor, nextStatus, note)` — validates state transition and appends event atomically.
- `submitRepairEvidence(issueId, afterImage)` — staff-only evidence upload and visual comparison.
- `confirmResolution(issueId, staffId, note, override)` — writes final decision and event in one transaction.
- `recordAuditEvent(...)` — server-authorized write only.
- `healthSummary()` — separate API, database, chat, vision and repair-verification state.

Do not trust client-supplied reporter ID, role, staff assignment, priority, confidence, resolution-pass flag or arbitrary event type.

### Python AI service — ai-vision-service

Suggested package boundaries:

- `app/main.py` — FastAPI routes and HTTP mapping.
- `app/schemas.py` — typed request/result schemas and response validation.
- `app/image_pipeline.py` — decode, EXIF orientation, bounds, normalized images and quality metrics.
- `app/providers/base.py` — shared provider interface and typed provider errors.
- `app/providers/llmfaucet.py` — optional keyless community gateway adapter.
- `app/providers/gemini.py` — optional Google provider when a server key is configured.
- `app/providers/groq.py` — optional Groq vision provider when a server key is configured.
- `app/provider_router.py` — capability checks, ordering, timeout, circuit breaker and status.
- `app/analysis.py` — prompt construction and normalized result.
- `app/repair_verification.py` — before/after comparison and conservative evidence checks.
- `app/chat.py` — civic help assistant using supplied current application context.
- `tests/` — provider-contract, image-validation and route tests.

The existing FastAPI service may be refactored to these boundaries without breaking its HTTP contract. It must not become a second civic-data database.

## 2. Current API catalogue and access

The production UI uses the Supabase Edge Function. Preserve existing paths as compatibility aliases.

| Method + path | Access | Purpose |
|---|---|---|
| GET `/api/health` | Public | API readiness summary |
| GET `/api/ai/health` | Public | Separate health per AI capability/provider |
| POST `/api/ai/analyze` | Public with rate limit | Ad-hoc image analysis |
| POST `/api/chat` | Rate limited | Civic help assistant |
| GET `/api/me` | Authenticated | Current profile and role |
| GET `/api/tickets` | Public | Paginated issue list with filters |
| POST `/api/tickets/report` | Optional auth; rate limited | Submit or merge issue |
| GET `/api/tickets/{id}/comments` | Per current policy | Read comments |
| POST `/api/tickets/{id}/comments` | Authenticated | Add comment as current user |
| GET `/api/tickets/{id}/events` | Per current policy | Read public-safe timeline |
| POST `/api/tickets/{id}/vote` | Authenticated | Toggle own vote |
| PATCH `/api/tickets/{id}/status` | Staff/admin | Assign or change status; cannot resolve directly |
| POST `/api/tickets/{id}/resolve` | Staff/admin | Upload after photo and request comparison |
| POST `/api/tickets/{id}/resolve/confirm` | Staff/admin | Explicit confirmation or reasoned override |

Issue list query allowlist: `status`, `defect_type`, `zone`, `near_lat`, `near_lng`, `radius_m`, `sort`, `page` and `page_size`. Recommended maximum page size is 100. Never forward unvalidated query values to a dynamic SQL statement.

## 3. Report request / response

Multipart fields:
- `file` — one supported image, maximum 8 MB after client-side compression.
- `defect_type` — `pothole|garbage|sewage|streetlight|unknown`.
- `description` — trimmed, 5–2000 characters.
- `latitude` and `longitude` — valid finite WGS84 coordinates.
- `landmark` — optional, max 200 characters.
- `idempotency_key` — client-generated key to protect retry from duplicate creation.

The server derives reporter identity from the access token; it never trusts a submitted user ID. The response includes the canonical issue, `merged` and `ai_status` (success, partial, unavailable). If DB/storage persistence succeeds, AI failure should normally result in a saved report with explicit degraded AI status.

## 4. AI analysis contract

Response fields:
- `status`: success, partial or unavailable.
- `provider`, `model`, `model_source`, `latency_ms`.
- `defect_type`, `confidence` in 0..1, `severity`, `priority_score` in 0..100.
- `damage_coverage_pct` in 0..100, `summary`, `visible_evidence`, `recommended_action`.
- `image_quality`, `quality_flags`, `bounding_boxes`.
- `human_review_required` and `limitations`.

Bounding boxes are normalized to [x1,y1,x2,y2] in 0..1 in the canonical response, regardless of provider's coordinate format. Clamp numeric values, reject malformed JSON, bound string/array sizes, normalize category, and force human review when low-confidence or poor-quality. A provider schema violation is a provider failure, not a successful analysis.

## 5. Error envelope

All errors return a request ID and a stable error code. Suggested HTTP mapping:

| HTTP | Code | Meaning |
|---|---|---|
| 400 | VALIDATION_ERROR | Malformed input, invalid enum or bad coordinates |
| 401 | UNAUTHENTICATED | Missing/invalid bearer token |
| 403 | FORBIDDEN | Role cannot perform operation |
| 404 | NOT_FOUND | Issue is not found or is not visible |
| 409 | CONFLICT | Illegal transition, missing original evidence, or conflicting idempotency key |
| 413 | FILE_TOO_LARGE | Upload exceeds safe limit |
| 429 | RATE_LIMITED | Account/IP/action limit reached |
| 502 | AI_PROVIDER_ERROR | Provider failed for an AI-only request |
| 504 | AI_TIMEOUT | AI request timed out |
| 500 | INTERNAL_ERROR | Safe generic message; details only in logs |

Do not disclose raw upstream response body, API keys, stack trace or internal URLs to the browser.

## 6. Workflow contracts

### Report intake

1. Validate the request, consume report limits, and verify image signature and size.
2. Store the image; clean up the object if the database write fails.
3. Run the create-or-merge RPC using the resident-selected category and safe baseline scores with `analysis_status=pending`.
4. If merged, delete the unused uploaded image and return `ai_status=skipped_merged`; do not infer for an image that is not attached to the canonical issue.
5. If created, schedule `runBackgroundIssueAnalysis` with `EdgeRuntime.waitUntil` and return `ai_status=pending` promptly.
6. The background task calls the AI orchestrator, validates canonical fields again, updates triage fields only on a valid successful result, and appends an audit event.
7. If inference or persistence fails, mark triage unavailable where possible and retain the issue for manual review.

AI unavailable returns explicit pending/partial/unavailable metadata; it must not fabricate a confirmed defect from the user-selected category. Supabase background tasks remain subject to hosted Edge Runtime limits, so a durable queue/outbox is the next step if workloads require stronger delivery guarantees.

### Duplicate merge

Candidate criteria: same normalized category, not resolved, within configured radius (currently documented at 15 m), optionally bounded by time window. Query through PostGIS `ST_DWithin` and the GiST index. Concurrent writes need advisory locking/row locking or a transactional Postgres RPC; application-level select-then-insert is race-prone. Increment frequency once per merged submission.

### Vote toggle

Use unique constraint `(issue_id, user_id)` and atomic insert/delete. Count comes from canonical rows/transaction; never accept a browser-provided count.

### Status transition

Allow only an explicit transition map. Update the issue and write `issue_events` in the same transaction/RPC. A resident cannot set status, assignment, priority or resolution timestamps. Resolution is a separate controlled workflow.

### Provider router

1. Get configured adapters supporting the requested capability.
2. Prefer an enabled and recently verified provider.
3. Apply per-task timeout and a bounded retry only for transient errors.
4. Validate provider output against schema; sanitize result.
5. Record provider/model/status/latency and safe failure class.
6. If no provider succeeds, run image-quality checks and return partial/unavailable.
7. Never turn unsupported image input into an AI classification, or ambiguous comparison into positive repair verification.

### Repair verification and confirmation

- Verify issue, staff role, issue state and original image path before calling AI.
- Store after evidence and AI recommendation separately from final resolution.
- Only staff confirmation changes status to Resolved.
- Confirmation and event insert are atomic; manual override requires non-empty staff note.
- AI unavailable/negative means staff must inspect evidence; it never grants automatic closure.

## 7. Security boundaries

- Public routes: validation, rate limits and anti-abuse controls.
- Roles derive from Auth plus server-side profile lookup.
- Service-role key is server-only; vision token is shared only between Edge Function and FastAPI.
- Restrict CORS to deployed app origins where practical.
- Private notes and identity data never appear in public comments/event metadata.
- AI prompt context treats report descriptions/comments as untrusted; no model-generated SQL/arbitrary tools.
- Export endpoints require role checks, pagination and audit events.

## 8. Performance and tests

- Use server-side pagination and narrow select lists.
- Use PostGIS for geo search; do not fetch every issue into the browser.
- Index common status/sort and issue-child lookup paths.
- Use an outbox worker for email/push; do not block report intake on providers.
- Contract tests: success, timeout, 429, 5xx, unsupported images, malformed JSON, invalid boxes.
- Database tests: RLS/role escalation, concurrent duplicate merge, unique vote, rollback, storage ownership and staff-only resolution.
- E2E: report while AI is down, report with AI, duplicate merge, comment/vote, staff status update, repair photo, staff confirm, audit timeline.
