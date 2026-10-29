# CivicPulse AI — High-Level Design (HLD)

**Status:** Proposed target architecture, based on repository and live Supabase inspection on 2026-10-29. This is a design artifact; it does not change production services.

## 1. Purpose

CivicPulse turns citizen-submitted civic observations into traceable municipal work items. Residents report issues with a photo and location, follow progress, comment and vote. Municipal staff prioritize, assign, update and review repairs. AI assists with categorization and evidence; it must never be the authority that closes an issue.

### Principles

1. One source of truth for civic data: Supabase Postgres/PostGIS. Do not dual-write live data to Supabase and MongoDB.
2. One frontend-facing CivicPulse API contract. The browser never calls AI providers directly.
3. AI is assistive and uncertain. Every prediction includes provider/model metadata, confidence, limitations and a human-review flag.
4. Fail safely: reports remain submit-able if AI is down; no fabricated classifications, fake detections, or false “verified” results.
5. Staff assignments, status changes, repair submissions and overrides create append-only audit events.
6. Secrets stay server-side. The browser may use the Supabase publishable key, never service-role, AI-provider or internal vision tokens.
7. Migrations are additive and tested. Do not recreate or destructively change the production schema.

## 2. Roles and permissions

| Role | Capabilities |
|---|---|
| Visitor | Browse public issues and map; read public status |
| Resident | Submit a report, see own reports, vote, comment, follow status |
| Staff | Dispatch board, assignment, workflow changes, repair evidence, review and confirmation |
| Admin | Staff roles, jurisdiction/zone configuration, moderation, analytics and exports |
| System worker | Provider calls, deduplication, notification delivery and SLA checks |

Authorization is checked server-side using the authenticated Supabase user and canonical profile role. Hiding a button in the UI is not access control.

## 3. Feature catalogue

### Core release

- Responsive landing page, issue map/list and details.
- Report form: category, description, photo, GPS/manual map point and landmark.
- Image resizing, validation, previews and privacy checks.
- Photo-quality analysis and optional AI-assisted issue categorization/severity.
- Duplicate-report lookup by normalized category and geographic proximity.
- Issue list filters, pagination, votes, comments and timeline.
- Staff dispatch board, assignment and controlled status transitions.
- Before/after repair evidence, AI recommendation and explicit staff confirmation.
- AI/chat health per capability, rate limits, audit logs and safe degraded mode.
- Role checks, RLS, server-side secrets and automated smoke tests.

### Designed extensions

- Email/in-app notifications, user preferences and reliable notification retries.
- Ward/zone/jurisdiction boundaries, staff coverage and SLA/escalation.
- Admin analytics: backlog, time to assign/resolve and recurring hotspots.
- Abuse/moderation queue, private staff notes and safer evidence visibility.
- Saved filters, CSV/PDF export, multilingual UI, accessible PWA and offline report drafts.
- Municipal-service integrations only where a real interface contract exists.

### Explicit non-goals for the first reliable release

- AI makes binding operational decisions or resolves tickets by itself.
- Generic YOLO labels are treated as a civic-defect classifier.
- Anonymous shared AI inference is the sole production dependency.
- Production frontend is pointed at the legacy MongoDB API.
- User identity or private staff information is made public.

## 4. Target architecture

~~~mermaid
flowchart TD
  R[Resident / Staff browser] --> V[Vercel: React + Vite]
  V -->|HTTPS + Supabase user JWT| API[Supabase Edge Function: CivicPulse API]
  API --> AUTH[Supabase Auth]
  API --> DB[(Supabase Postgres + PostGIS)]
  API --> STORE[Supabase Storage]
  API -->|Internal token only| AI[Python FastAPI AI orchestrator]
  AI --> FREE[Keyless community provider adapter]
  AI --> OPT[Optional Gemini / Groq provider with server secret]
  AI --> CV[Local OpenCV quality checks]
  API --> OUTBOX[Future notification outbox / worker]
  OUTBOX --> EMAIL[Optional email provider]
  API --> OBS[Safe logs / metrics / request IDs]
  AI --> OBS
~~~

### Responsibilities

- **React/Vite on Vercel:** presentation, client-side validation, image preparation, map interaction and auth-session handling.
- **Supabase Edge Function:** stable frontend API, request validation, role checks, rate limits, storage orchestration, canonical database writes and audit events.
- **Supabase Auth:** identity, token validation and account lifecycle.
- **Postgres/PostGIS:** canonical issue data, relational integrity, geospatial lookup and audit trail.
- **Supabase Storage:** issue and repair images. Visibility must be explicit; never upload identity documents or unrelated personal images.
- **Python FastAPI AI service:** image normalization, quality checks, structured inference, capability-aware provider fallback, result validation, repair comparison and AI health. It must not keep a second civic database.
- **Provider adapters:** isolate changing vendor payloads, models, credentials and outages behind one internal contract.
- **Future notification worker:** retries delivery from an outbox and does not block report creation.

### Existing code disposition

- Keep the existing Vercel frontend and adapt it to the canonical API contract.
- Keep Supabase as the live data, auth and storage system.
- Reuse and harden the Python FastAPI vision service as AI orchestrator.
- Keep Express/Mongoose/MongoDB as legacy/local code only; do not route production traffic or civic writes to it.
- Treat the current keyless gateway as experimental until real text, vision and repair-comparison requests pass.

## 5. Key flows

### Report intake

1. Resident chooses GPS or a manual map point, adds category, description and photo.
2. Browser resizes photo and sends multipart data with idempotency key.
3. API validates input, image signature, size, coordinates and rate limits.
4. API stores the image and invokes AI with an independent timeout.
5. AI runs local quality checks and attempts a verified vision provider.
6. API performs same-category PostGIS duplicate lookup. A transactional operation merges or creates the issue.
7. API writes an audit event and returns explicit AI status: success, partial or unavailable.
8. AI outage does not discard a valid report; no classification is fabricated.

### Repair verification

1. Staff uploads after-repair evidence.
2. API checks staff permission and original image, then stores evidence.
3. AI compares both photos and returns a conservative recommendation.
4. The issue stays open until a staff member explicitly confirms or records a reasoned override.
5. Decision and event are persisted atomically. AI timeout is never a positive verification.

## 6. Security and reliability

- Every request has a correlation ID; errors never reveal secrets, provider bodies or stack traces.
- Validate image type, signature, byte size and decoded dimensions server-side.
- Bound AI calls with timeout, rate limit and a small retry budget.
- “Configured” is not equal to “available”. Health is tracked independently for chat, vision analysis and repair verification.
- Public intake receives rate limiting and anti-abuse controls. Staff actions require a valid token and server-verified role.
- RLS and Storage policies are reviewed; service-role access is server-only and bypassing RLS means every staff/resident action must be explicitly authorized in code.
- Map and geocoder integrations must comply with their current provider policies.
- Log provider/model/status/latency and error class, not credentials, full prompts or raw image content.

## 7. Non-functional targets

These are targets to measure after instrumentation, not claims about current production performance.

| Area | Target |
|---|---|
| Civic API excluding AI | p95 under 500 ms under an agreed test load |
| AI request | bounded timeout around 45 s; report persists if AI is down |
| Data integrity | no duplicate vote per user/issue; no resident resolution; status changes audited |
| Security | server-side roles, RLS and Storage review, secrets scan, upload validation |
| Observability | request ID, capability-specific provider health, latency and safe error code |
| Release | automated build/tests + post-deploy smoke test |

## 8. Architecture decisions

- **ADR-001:** Supabase is the single civic source of truth; avoid Postgres/Mongo dual writes.
- **ADR-002:** Python FastAPI is the internal AI orchestrator; vendor differences stay behind adapters.
- **ADR-003:** Keyless shared inference is best-effort. Optional Gemini/Groq providers may be enabled with server-side keys.
- **ADR-004:** Human confirmation is required to resolve an issue.
- **ADR-005:** Additive, reviewed migrations only; preserve current production schema compatibility.
- **ADR-006:** Capability-based health; chat, image analysis and repair comparison may have different availability.
