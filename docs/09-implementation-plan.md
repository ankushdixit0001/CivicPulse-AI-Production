# CivicPulse AI — Incremental Implementation Plan

**Baseline:** 2026-10-30  
**Repository:** `ankushdixit0001/CivicPulse-AI-Production`  
**Implementation branch:** `architecture/implementation-plan`  
**Production data source:** Supabase PostgreSQL 17 + PostGIS  
**Status:** Plan created after workspace inspection; no production infrastructure mutated.

## 1. Operating rules

1. PostgreSQL is the only authoritative application data store. Do not add MongoDB, file-based, or provider-side duplicate write sources.
2. Keep the existing production repository and its user data. Treat `CivicPulse-AI` (without `-Production`) as historical reference only.
3. Make additive, reviewable changes on feature branches. Do not rewrite existing files, migrations, configuration, or production data without a reviewed diff and explicit approval.
4. Build and test against a disposable local/staging database first. Do not apply unverified migrations to the active Supabase project.
5. AI is advisory. It may classify, summarize, estimate urgency, identify duplicates, and compare evidence; it cannot assign staff, change workflow state, or resolve an issue without authorized human action.
6. Provider adapters must be replaceable. A provider outage must not block civic reporting; return an explicit `unavailable` / `needs_review` result instead of fabricated AI output.
7. Every state-changing workflow must append an immutable audit event in the same database transaction.
8. Do not expose service-role keys, model keys, private evidence URLs, or internal AI metadata to the browser.
9. Every phase has acceptance criteria, automated tests, security review, and a documented rollback/recovery path.
10. Report only tests that were actually executed; distinguish static inspection, local tests, staging smoke tests, and production verification.

## 2. Baseline discovered

- Production repo: `CivicPulse-AI-Production`, default branch `main`; current React/Vite frontend, Supabase Edge Function, SQL migrations and FastAPI vision service are present.
- Supabase project `CivicPulse-AI` (`ccrhdrjywnaccthzyjte`) is ACTIVE_HEALTHY in `ap-south-1`; Postgres 17.11 and PostGIS are present.
- Existing tables: `profiles`, `civic_issues`, `issue_events`, `issue_comments`, `issue_votes`, `civic_api_rate_limits`. Three issue rows and five event rows were present at inspection.
- Live Edge Function `civicpulse-api` is ACTIVE v14 with platform JWT verification disabled; handler-level token and role checks are therefore security-critical.
- Storage bucket `civic-issue-images` is currently public with an 8 MiB image cap. Private-by-default is the target, but migration must wait for signed-media delivery, public thumbnail policy, legacy URL handling and owner approval.
- Live migration history has an `index_foreign_keys` entry absent from the tracked migration tree and different timestamps from tracked files. Reconciliation is a prerequisite to schema deployment.
- Confirmed defects include an event constraint that rejects the `resolved` event inserted by the API, non-atomic status/event writes, duplicate-report race potential, and a vote/report counter semantic collision.
- Security Advisor reports leaked-password protection disabled. Performance Advisor reports eight unused indexes; do not remove these based on the current tiny data sample.
- Vercel project exists. Git-to-Vercel automatic deployment linkage and release SHA traceability remain unconfirmed.
- Existing README and older hackathon brief contain stale statements that conflict with the newer live Supabase architecture. Update them only after validating the actual code paths and deployment contract.

## 3. Target modular architecture

### Web client
React + TypeScript + Vite + Tailwind. Feature modules: citizen reporting, issue discovery/tracking, staff work queue, admin configuration, notifications, analytics, maps and accessibility/localization. Browser code uses only the Supabase publishable key and short-lived user JWT.

### Application API
Supabase Edge Functions (Deno/TypeScript) remain the trusted application boundary. Split the current monolithic handler into route modules, authorization middleware, schema validation, repository/data-access functions, audit helpers, rate limiting and response projections. The Edge API validates user JWTs and database-controlled roles on every protected route.

### System of record
Supabase PostgreSQL + PostGIS owns users' application profiles, issues, reports/contributions, evidence metadata, AI analysis records, assignments, departments/wards, status history, comments, votes, notifications, preferences, moderation and analytics aggregates. RLS applies to all exposed tables. Use SQL transactions/RPCs for atomic multi-row state changes.

### AI orchestration
Python FastAPI owns image decoding, safety/quality checks, preprocessing, provider selection, structured response validation and inference telemetry. Keep adapters behind interfaces (for example `VisionProvider`, `TextProvider`, `EmbeddingProvider`). OpenAI is a candidate hosted adapter; local/open-source models are optional candidates only after benchmark and license review. No community gateway is a production fallback unless its terms, privacy, reliability and API contract are independently verified.

### External systems
Map/geocoding, email, SMS and push are adapters with quotas, timeouts, retry policy, monitoring and opt-out controls. Store provider IDs and delivery outcomes in PostgreSQL; providers are not the source of truth.

## 4. Execution phases

### Phase 0 — Discovery and preservation (completed)
**Deliverables:** workspace audit, current state, service inventory, baseline risks and branch strategy.  
**Acceptance:** production repository, Supabase project and Vercel project identified; production-vs-legacy paths distinguished; current records preserved.

### Phase 1 — Requirements and design baseline (substantially completed)
**Deliverables:** approved scope, HLD, LLD, ERD, state machine, role matrix, API contracts, threat model, provider decision register and acceptance matrix.  
**Remaining:** reconcile the user's complete master requirements with the tracked docs; mark each capability as required, optional, deferred or prohibited.  
**Acceptance:** every requirement maps to a module, table/API contract, test and acceptance criterion.

### Phase 2 — Provider/API verification (in progress)
**Deliverables:** provider matrix with official docs, authentication model, quotas, pricing, data handling, free/open-source alternatives, license and operational caveats.  
**Candidates to verify:** Supabase Auth/Storage/Realtime/Edge Functions; OpenAI vision/text; local Hugging Face/Ultralytics/OpenCV options; OSM/Nominatim or managed geocoding/tiles; email/SMS/push providers.  
**Acceptance:** no endpoint, model capability, free tier, SLA or pricing is described as verified without current official evidence and an explicit test result.

### Phase 3 — Database and migration foundation
**Order:**
1. Export/compare live schema, tracked migrations and migration history; identify exact missing migration SQL and timestamp mapping.
2. Establish a reproducible clean baseline in local/staging without resetting production.
3. Add reviewed, forward-only migrations for event type correctness and transactional workflow/audit operations.
4. Separate resident report contributions from canonical incidents; add idempotency keys and safe duplicate merge locking.
5. Separate explicit votes from report frequency; make counters transactionally correct or derive them from source rows.
6. Add normalized evidence and immutable AI analysis records with provider/model/prompt versions and retention metadata.
7. Add municipal organization hierarchy (jurisdiction, department, ward/zone, SLA policy, staff membership and assignment history) only after taxonomy is approved.
8. Add notification preferences/outbox/delivery records and analytics-friendly indexes/materialized views only with defined use cases.
9. Apply RLS, grants, storage object policies and least-privilege function grants; run Supabase advisors.
**Acceptance:** clean database bootstrap succeeds; migration history reconciles; all constraints/FKs/indexes are verified; role matrix passes RLS tests; concurrent duplicate/vote tests pass; status and event commit or roll back together.

### Phase 4 — API and authorization foundation
**Deliverables:** versioned endpoint contracts, route modules, strict Zod/Pydantic-equivalent validation, bounded cursor pagination, idempotency, consistent error envelopes, request correlation IDs, CORS allowlist, token verification and database-backed staff/admin authorization.  
**Acceptance:** contract tests for every route; unauthorized/expired JWT and role-escalation tests fail closed; public intake remains usable without exposing privileged data; API responses omit internal metadata and private media paths.

### Phase 5 — Citizen experience
**Deliverables:** responsive registration/login, anonymous/authenticated reporting, multi-photo evidence, geolocation/map pin, address search, draft/resume, report timeline, comments/votes, duplicate linkage, accessibility and localization hooks.  
**Acceptance:** mobile and desktop E2E; file type/signature/size/pixel validation; coordinate validation; safe upload; report idempotency; provider outage does not block submission; privacy disclosure and consent are explicit.

### Phase 6 — Staff and municipal administration
**Deliverables:** staff queue, department/ward filters, assignment and reassignment, SLA timers/escalation, work notes, evidence review, audit timeline, role management, service area configuration and controlled reopening.  
**Acceptance:** staff can only access authorized jurisdictions/queues; every assignment/status/reopen action is audited; no citizen or AI-only action can mark an issue resolved; manual resolution requires staff identity and review note.

### Phase 7 — AI orchestration and vision
**Deliverables:** FastAPI modular service; provider adapter interfaces; image safety/quality checks; category classification; severity/priority recommendation; visible-evidence descriptions; bounding boxes where supported; duplicate similarity suggestion; resolution evidence comparison; structured outputs and versioned prompts.  
**Acceptance:** provider contract tests, malformed-output tests, timeouts/retries/circuit breaker, image size/pixel safeguards, confidence calibration/evaluation report, bias/error review and explicit human-review status. AI failure returns a truthful unavailable state and does not mutate issue workflow.

### Phase 8 — Geospatial and discovery
**Deliverables:** PostGIS radius/viewport queries, jurisdiction boundaries, ward assignment, map clustering, coordinate precision policy, geocoding cache and provider attribution.  
**Acceptance:** SRID/order/bounds tests, distance boundary tests, spatial query plan review, rate-limit/cache tests, and no exposure of restricted exact coordinates.

### Phase 9 — Notifications and realtime
**Deliverables:** transactional outbox, notification preferences, email/SMS/push adapters, retries, deduplication, delivery status, unsubscribe/consent, Supabase Realtime subscriptions for permitted views.  
**Acceptance:** outbox event and business transaction atomic; provider failure is retryable; no duplicate notification after retry; privacy-safe templates; RLS/realtime authorization verified.

### Phase 10 — Analytics and reporting
**Deliverables:** resident-facing status transparency; staff/admin dashboards; backlog, SLA, category, geography, resolution-time and repeat-incident metrics; export with scoped permissions.  
**Acceptance:** aggregates reconcile with source rows; access scoped by role/jurisdiction; query plans and retention documented; metrics clearly distinguish sample counts from population-level claims.

### Phase 11 — Security, QA and release hardening
**Deliverables:** threat model, RLS matrix tests, dependency scanning, secret scanning, SAST, image upload abuse tests, rate-limit tests, audit integrity tests, backup/restore runbook, observability, incident response and load tests.  
**Acceptance:** no critical/high unresolved security finding; no secrets in browser bundle or repository; production data restore tested in isolated environment; p95/error/availability targets agreed and measured; all P0 defects closed.

### Phase 12 — Deployment and pilot
**Deliverables:** reproducible CI/CD, separate dev/staging/prod environments, environment variable inventory, migration promotion workflow, Vercel release linkage, FastAPI container deployment, health checks, rollback runbook and pilot guide.  
**Acceptance:** release commit traceable; staging E2E green; production smoke checks pass; AI provider, quotas and cost alerts configured; operator ownership and support process assigned. Pilot expansion is gated on measured quality and municipal sign-off.

## 5. Cross-cutting engineering standards

- TypeScript strict mode; Python type hints and Pydantic request/response models.
- Pin dependencies and commit lockfiles; automated dependency and license review.
- No unbounded list endpoints, unrestricted uploads, client-controlled role claims or service keys in client code.
- Use UTC timestamps; store coordinates as PostGIS geography(Point,4326) with explicit longitude/latitude contract.
- Use immutable append-only audit records; corrections are compensating events, not edits to historical events.
- Use correlation IDs, structured redacted logs, metrics and provider latency/error/cost tracking.
- Use database constraints as final invariants; API validation is not a substitute.
- Feature flags for external providers and expensive AI capabilities; manual fallback always available.
- Document every schema, API, provider, security and deployment decision in ADRs.

## 6. Open decisions requiring owner input before affected production rollout

1. **Evidence visibility:** approve private original photos with expiring signed access and separately redacted public thumbnails, or explicitly retain public original photos with a documented privacy/retention policy. The production bucket must not be flipped until the UI and access path are ready.
2. **Municipal structure:** provide pilot city/municipality, department names, ward/zone identifiers and staff ownership model. Keep taxonomy configurable until supplied.
3. **AI budget/provider:** approve a monthly inference budget and hosted-vs-local preference. Open-source models require an evaluation set and license review; do not claim equivalent accuracy.
4. **Notifications:** approve channels (email, SMS, push) and consent rules before sending real messages.
5. **Pilot service levels:** approve expected report volume, response targets, retention and support/on-call owner.

## 7. Immediate next actions

1. Complete the remaining source audit: exact frontend-to-Edge routes, FastAPI provider implementation, all RLS/storage policies, migration drift and Vercel Git linkage.
2. Create an isolated staging/test target; do not use the active production project as a migration test bed.
3. Produce a migration reconciliation report and test the proposed database baseline from empty state.
4. Implement the P0 audit/event transaction fix in a reviewed feature branch with database integration tests.
5. Add CI gates before expanding feature work.
6. Only after database/API/security gates pass, implement citizen and staff features in vertical slices.

## 8. Current execution status

- [x] Workspace inspected; production repository and platform resources identified.
- [x] Existing HLD, LLD, ERD, API research and audit read.
- [x] Live database inventory, migration history, Edge Function status and security/performance advisors inspected.
- [x] Dedicated implementation branch created.
- [x] This incremental implementation plan added as a new document.
- [ ] Full master-spec-to-requirement traceability.
- [ ] Migration reconciliation and isolated staging bootstrap.
- [ ] P0 database/API fixes and automated regression tests.
- [ ] Feature implementation phases 4–10.
- [ ] Production release readiness and pilot sign-off.

**No production migration, storage policy, function deployment, secret, Vercel deployment, or existing application source was changed as part of this plan.**
