# CivicPulse AI — Feature Catalogue and Delivery Plan

**Date:** 2026-10-30  
**Rule:** A feature is “implemented” only when its backend/data behavior, permissions, error cases and acceptance tests are in place. A button or mock dashboard is not sufficient.

## 1. Feature catalogue

| ID | Feature | Priority | Data/API dependency | Acceptance evidence |
|---|---|---:|---|---|
| F-001 | Responsive resident web app | P0 | Frontend routes | Mobile/desktop and accessibility smoke tests |
| F-002 | Sign up, sign in, sign out, session handling | P0 | Supabase Auth + profiles | Session expiry and invalid-token tests |
| F-003 | Resident/staff/admin RBAC | P0 | Trusted profile roles + Edge checks | Resident cannot assign, moderate, or close tickets |
| F-004 | Create report with category, description, coordinates, landmark | P0 | Edge API + Postgres/PostGIS | Valid/invalid coordinate and empty-report tests |
| F-005 | Camera/gallery photo upload and preview | P0 | Browser + Storage | Type/signature/size/dimension tests |
| F-006 | Server image-quality assessment | P0 | FastAPI + OpenCV/Pillow | Blurry, too-dark, overexposed, malformed-photo tests |
| F-007 | AI civic-defect triage | P1 | Configured multimodal provider | Labeled test set; model failures result in partial state |
| F-008 | Issue feed, detail, pagination, category/status/zone filters | P0 | Edge API + indexes | Query/filter integration tests |
| F-009 | Map pins and geospatial views | P0 | PostGIS + Leaflet | Correct longitude/latitude; no fabricated points |
| F-010 | Duplicate candidate detection | P0 | PostGIS `ST_DWithin` | Distance/category boundary and concurrent submission tests |
| F-011 | Preserve all duplicate submissions and evidence | P1 | `issue_reports` + `issue_media` | Merge does not lose reporter/photo/context |
| F-012 | Votes, counts, and comments | P0 | Existing tables + rate limits | One vote/user and ownership tests |
| F-013 | Staff queue, assignment, status change | P0 | RBAC + audit events | Unauthorized transition and double-assignment tests |
| F-014 | Immutable issue timeline | P0 | `issue_events` | Events include actor, timestamp, old/new state |
| F-015 | Before/after photo submission | P0 | Storage + media metadata | Both records are retained and bound to the ticket |
| F-016 | AI-assisted repair verification | P1 | Vision provider | Provider down/ambiguous image never closes issue |
| F-017 | Explicit staff resolution confirmation | P0 | Status API + audit | Positive verification still requires staff confirmation |
| F-018 | Truthful AI capability dashboard | P0 | Health route + provider telemetry | Missing keys / 429 / timeout reported as degraded |
| F-019 | Explainable priority score | P1 | Versioned rules + normalized triage | Rule outputs are reproducible and auditable |
| F-020 | Departments and assignment history | P1 | `departments`, `issue_assignments` | Assignment history reconciles with active ticket owner |
| F-021 | Ward/zone dashboard, heatmap, SLA/aging | P1 | Spatial aggregation + indexes | Aggregated views match sampled tickets |
| F-022 | Issue subscriptions and status notifications | P1 | `issue_subscriptions`, outbox | Retry/idempotency/unsubscribe tests |
| F-023 | Civic help chatbot | P1 | FastAPI chat + provider/FAQ | No fabricated live ticket or local government facts |
| F-024 | Multilingual replies/translation | P2 | AI provider + locale field | Original text retained; language tests |
| F-025 | Speech-to-text report entry | P2 | Browser support or configured transcription API | Accessibility and permission fallback tests |
| F-026 | Semantic search and related tickets | P2 | Embeddings + pgvector + PostGIS | Benchmarked recall/precision before enabling |
| F-027 | CAPTCHA/abuse controls | P1 before broad public launch | Edge API + challenge provider | Automated spam/bot test |
| F-028 | Moderation and safe public-media publishing | P1 | Moderation workflow + private storage | Unreviewed uploads are not publicly reachable |
| F-029 | Offline drafts and resumable uploads | P2 | IndexedDB / upload protocol | Offline/refresh recovery tests |
| F-030 | Multi-municipality tenancy | P2 | Municipality/service-area tables | Tenant isolation and cross-tenant access tests |
| F-031 | CSV/PDF export and public trend reports | P2 | Authorized export API | Exports respect roles and data minimization |
| F-032 | Email/web-push notifications | P1 | Configured outbound provider + outbox | Bounces, retries, unsubscribe and duplicate event tests |
| F-033 | AI feedback/quality evaluation console | P1 | `ai_analysis_runs` + `ai_feedback` | Corrections are retained and used in offline evaluation |
| F-034 | Production observability | P0 | Structured logs, uptime checks, error budgets | Alert test and no secret/PII leakage |

## 2. Release gates

### Gate A — architectural foundation
- HLD, LLD, database design, provider matrix and API contracts committed.
- Source of truth and service boundaries documented.
- Existing production schema captured; no database reset.

### Gate B — provider correctness
- Central provider abstraction in FastAPI.
- No public shared bearer token used as a production AI credential.
- Provider outputs normalized in one place.
- Test coverage for missing keys, malformed response, timeout, 401/429/5xx, invalid image and quota exhaustion.
- Health differentiates key configured, last successful request and per-task capability.

### Gate C — data correctness
- Idempotent intake and duplicate-safe transaction boundaries.
- Additive schema migration tested on clean DB and restored schema snapshot.
- Individual report/media history survives canonical issue merging.
- RLS and server-side role checks verified.

### Gate D — end-to-end
- Resident sign-in/guest policy, report upload, AI partial/success result, issue feed/map, comments/votes, staff assignment/status, repair photos, staff confirmation, and timeline all pass in a deployed test environment.
- Image links obey visibility policy.
- No key appears in client bundle, source, logs or error response.

### Gate E — limited release
- CAPTCHA/anti-abuse plan, privacy notice and provider terms approved.
- Monitoring and rollback are available.
- Feature flags permit disabling AI or external provider routing without disabling report creation.
- A model evaluation set and manual override workflow are in place.

## 3. Proposed implementation sequence

1. **Design & audit (this branch):** HLD, LLD, DB design, provider matrix, feature catalogue.
2. **AI reliability:** move all AI calls behind FastAPI adapters; remove direct Edge Function provider logic; add provider tests; fix truthful capability health.
3. **Data integrity:** add report/media/AI audit tables; preserve old fields during cutover; add idempotency and duplicate race protection.
4. **Workflow integrity:** tighten assignment, state transition and repair confirmation logic.
5. **Frontend integrity:** wire truthful AI health and clear partial/unavailable states; remove any prototype actions that imply persistence without a tested API.
6. **Operational features:** departments, analytics, subscriptions and notifications.
7. **P2 improvements:** multilingual, voice, semantic search, offline drafts and multi-tenant support after evaluation.
8. **Release:** staging deployment, end-to-end matrix, monitored rollout and rollback.

## 4. Required project environment variables

### Supabase Edge Function runtime secrets
- `AI_SERVICE_URL`: actual deployed FastAPI base URL; no trailing `/analyze`.
- `AI_SERVICE_TOKEN`: same random service token as `VISION_API_TOKEN` on the AI host.

### FastAPI host secrets/config
- `VISION_API_TOKEN`: required private service-to-service token.
- `GEMINI_API_KEY`: optional secret for Gemini API.
- `OPENROUTER_API_KEY`: optional secret for the OpenRouter adapter.
- `OPENAI_API_KEY`: optional existing compatibility provider.
- `GEMINI_MODEL`, `OPENROUTER_VISION_MODEL`, `OPENROUTER_CHAT_MODEL`, `OPENAI_VISION_MODEL`: model IDs, not secrets.
- `AI_PROVIDER_PRIORITY`: comma-separated provider order.
- `ALLOW_EXTERNAL_IMAGE_AI`: explicit policy flag for external processing of submitted image data; false until privacy/consent policy is approved.
- `ALLOW_OPENROUTER_IMAGE_FALLBACK`: false by default because the selected free route warns against personal/confidential content.
- Provider timeouts/rate limits, log level and feature flags.

Never set any provider key as a Vite `VITE_*` environment variable. The browser must not directly call model vendors.

## 5. Release-status honesty

A source file, design, configured secret, or successful frontend build does not prove live AI inference works. Release notes must distinguish:
- **Designed** — documented in this plan.
- **Implemented** — code and automated tests exist.
- **Configured** — secrets/service URL are present.
- **Live-tested** — deployed request succeeds against non-personal test data.
- **Production-verified** — end-to-end workflow, failure paths and permissions pass.
