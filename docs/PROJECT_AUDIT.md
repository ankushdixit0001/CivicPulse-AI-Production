# CivicPulse AI — Project Discovery & Audit
**Date:** 2026-10-30  
**Scope:** Phase 0 only; read-only inspection of the repository's `main` branch.  
**Repository:** https://github.com/ankushdixit0001/CivicPulse-AI-Production

## 1. Executive summary

The repository is an existing, partially implemented CivicPulse AI product, not a blank starter. It contains:
- React 18 + Vite + Tailwind frontend (`frontend-app/`).
- Supabase Edge Function API (`supabase/functions/civicpulse-api/index.ts`) and PostgreSQL/PostGIS migrations.
- Python FastAPI vision service (`ai-vision-service/`) with OpenCV, Pillow, optional Ultralytics YOLO and an OpenAI vision adapter.
- Legacy Express + Socket.IO + Mongoose backend (`backend-service/`) with MongoDB persistence.
- Render Blueprint (`render.yaml`) for the vision container and Vercel deployment documentation.

**Critical architecture finding:** there are two backend/data architectures in the repository. The deployment guide says the production frontend calls Supabase Edge Functions and Supabase/Postgres is the production source of truth; the legacy Express/MongoDB API is not connected to the deployed frontend. The Python vision service is separate and its deployment/configuration is listed as incomplete. The README has older statements that conflict with the later deployment guide. Documentation must be reconciled.

## 2. Inspected repository evidence

Read from the default branch:
- `README.md`
- `DEPLOYMENT.md`
- root `package.json`
- root `.env.example`
- `frontend-app/package.json`
- `frontend-app/src/App.jsx`
- `backend-service/package.json`
- `ai-vision-service/requirements.txt`
- `ai-vision-service/app/main.py`
- `ai-vision-service/tests/test_vision.py`
- `supabase/functions/civicpulse-api/index.ts`
- all seven migrations currently present in `supabase/migrations/`.

Tree inspection identified:
- `supabase/migrations/20261029130000_initial_civicpulse_schema.sql`
- `20261029133000_restrict_issue_event_writes.sql`
- `20261029140000_add_issue_landmark.sql`
- `20261029150000_public_issue_api_storage_and_rpc.sql`
- `20261029151000_restrict_direct_public_issue_inserts.sql`
- `20261029152000_add_civic_report_rate_limit.sql`
- `20261029153000_rate_limit_service_role_policy.sql`.

This audit is source inspection, not a production penetration test or a complete execution of all test suites.

## 3. Existing implementation inventory

| Area | Current repository state | Audit observation |
|---|---|---|
| Frontend | React 18, Vite, Tailwind, React Router, React-Leaflet | Small SPA with landing, report and command-center routes; much of the UI is in one large App.jsx |
| API | Supabase Edge Function | Current deployed architecture according to DEPLOYMENT.md |
| Legacy API | Express, Mongoose, Socket.IO | Separate MongoDB domain; do not use as a second production source of truth |
| Identity | Supabase Auth and profiles | Basic resident/staff/admin roles in initial migration |
| Database | Postgres, PostGIS | Current schema is narrower than master specification |
| Storage | Supabase Storage bucket | Existing migration makes issue images public |
| Vision | FastAPI + OpenCV/Pillow | Quality checks, provider-based image reasoning and before/after verification code |
| Object detection | Optional YOLOv8n COCO | Generic object context only; not a validated civic-defect model |
| AI chat | Edge Function provider call / legacy chat route | Provider contract and model capability require independent verification |
| Duplicate handling | PostGIS function | Current function merges same-category, unresolved reports within 15 metres |
| Notifications | No complete delivery subsystem evidenced in inspected docs/files | Design required |
| Analytics | Command-center UI and DB-backed listing | Full analytical data model and audited aggregates not evidenced |
| Realtime | Socket.IO dependency in legacy API; Supabase Realtime available | Live production subscription is not evidenced as complete |
| CI/CD | Vercel and Render config/docs | Need inspect actual GitHub Actions and deployed service settings in later implementation phase |
| Tests | Python vision regression tests present | No full test run performed in this audit |

## 4. Important code-level observations

### 4.1 Frontend
- Uses React 18, React Router and React-Leaflet.
- Current routes observed: `/`, `/report`, `/command-center`.
- API base defaults to Supabase Edge Function URL outside development.
- Supabase URL is hard-coded in frontend source; environment-based configuration should be standardized.
- Map uses public OpenStreetMap raster tile endpoint.
- Chat request is sent to `/api/chat`; this needs to be checked against the current Edge Function route contract.
- Main application code is concentrated in `App.jsx`; modular feature boundaries are needed.
- Frontend package currently does not list TypeScript, TanStack Query, React Hook Form or Zod. These are proposed additions, not existing dependencies.

### 4.2 Supabase API
- Edge Function creates a Supabase client using `SUPABASE_SERVICE_ROLE_KEY` on the server.
- Staff authorization reads `profiles.role` and accepts `staff` or `admin`.
- Public report creation is routed through a service-role-only RPC after direct anonymous inserts were revoked.
- CORS currently allows `*`; production origin allow-listing should be considered.
- The API has a keyless community inference integration hard-coded to `https://api.llmfaucet.dev/v1/chat/completions`, model `auto:smart`, using bearer value `free`. Its availability, image capability, terms, privacy and response contract are not verified by source inspection. Treat it as experimental, not production-ready.
- API behavior needs formal request/response schemas, API versioning and provider abstraction.

### 4.3 Database
Initial migration includes:
- `profiles`
- `civic_issues`
- `issue_events`
- `issue_comments`
- `issue_votes`
- role/status/severity enums
- PostGIS geography point and GiST index
- updated-at triggers
- auth-user profile trigger
- initial RLS policies.

Subsequent migrations:
- restrict direct issue-event writes to staff/admin;
- add landmark;
- allow public issue reads;
- add public storage bucket and service-role report RPC;
- revoke direct anonymous issue inserts;
- add service-role report rate-limit table/function.

The current schema is not yet the complete master specification. It lacks explicit relational entities for departments, wards, categories, assignment history, media metadata, AI job history, provider usage, duplicate candidates, SLA policies, escalations, notifications, device tokens, audit logs, idempotency and analytics snapshots.

### 4.4 Python vision service
- FastAPI service with image byte/dimension/pixel validation.
- OpenCV quality metrics and EXIF orientation handling.
- Optional YOLO model is disabled unless explicitly enabled; generic COCO classes are supplemental context.
- Existing primary reasoning adapter reads `OPENAI_API_KEY` and uses `gpt-4.1-mini` by default.
- Vision output is normalized and bounding boxes are validated.
- Priority score is derived from category weights and damage coverage; it is currently a heuristic and needs calibration against labeled municipal data.
- Repair verification checks image quality and damage reduction, but must remain advisory.
- Health and endpoint contract need to be inspected in LLD/API research and tested after deployment.
- Requirements pin Torch and Ultralytics, which may create a large image and slow cold starts on small/free container plans.

### 4.5 Legacy Express backend
- Uses Express, Mongoose, MongoDB and Socket.IO.
- Separate persistence and authorization model.
- Do not connect production UI to this API unless there is an explicit migration plan.
- Archive, isolate or remove only after verifying no required route or feature is still used.

## 5. Risks and gaps

| ID | Risk | Severity | Required treatment |
|---|---|---|---|
| AUD-01 | Two backend/data architectures | Critical | Declare Supabase/Postgres sole production source of truth |
| AUD-02 | Public issue images bucket | High | Decide public evidence vs private originals; signed URLs and privacy review |
| AUD-03 | AI community endpoint not verified | High | Remove from production trust path until tested, contract documented and privacy approved |
| AUD-04 | AI classification quality uncalibrated | High | Dataset/evaluation, confidence calibration, staff review |
| AUD-05 | Duplicate RPC auto-merges on 15m + category only | High | Candidate scoring and review; avoid false merges |
| AUD-06 | Current role set is coarse | High | Tenant/city/department/ward-scoped permissions |
| AUD-07 | CORS wildcard | Medium/High | Explicit production origins; preserve intended public intake without broad browser trust |
| AUD-08 | API versioning and schemas incomplete | High | Versioned contracts and generated OpenAPI |
| AUD-09 | No durable background job design evident | High | Add job/outbox model and retry semantics |
| AUD-10 | Notification delivery not evidenced | Medium | Provider adapter + delivery ledger |
| AUD-11 | Large single frontend component | Medium | Feature modules and typed API clients |
| AUD-12 | Free geocoding/tiles may have restrictive policies | High | Provider abstraction, quotas, caching, attribution |
| AUD-13 | Service deployment incomplete | High | Deploy vision service, secret wiring, health and smoke tests |
| AUD-14 | Documentation contradictions | High | Treat deployment guide and actual production config as authority; reconcile README |
| AUD-15 | No live end-to-end evidence in this audit | High | Do not call platform production-ready until smoke suite is run |

## 6. Recommended disposition

**Retain**
- React frontend and existing visual assets where useful.
- Supabase Auth, Postgres, PostGIS, Edge Function and migration foundation.
- Python FastAPI image validation and response normalization.
- Existing audit/event concepts and regression tests.

**Refactor**
- Frontend into feature modules and typed components.
- Edge Function into modular services with strict schemas.
- AI service into provider adapters and asynchronous jobs.
- Database roles and tenant scoping.
- Duplicate detection and repair verification workflows.
- API docs, error model and observability.

**Quarantine pending decision**
- Legacy Express/MongoDB API.
- Unverified free inference endpoint.
- Public storage policy for original citizen photos.

## 7. Phase 0 exit criteria

- [x] Existing architecture identified.
- [x] Main application, API, database and vision files inspected.
- [x] Existing migrations enumerated and core schema reviewed.
- [x] Major architecture conflicts documented.
- [x] Reuse/refactor/quarantine recommendations recorded.
- [ ] Production runtime and all live integrations independently smoke-tested (not part of read-only repo audit).

**Conclusion:** The repository is a viable starting point but not a complete implementation of the master specification. Phase 1–4 documents must describe the target architecture, explicitly distinguish current state from target state, and avoid treating planned functionality as already working.
