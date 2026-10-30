# 00 — CivicPulse AI Project Audit

**Assessment date:** 2026-10-30  
**Repository:** `ankushdixit0001/CivicPulse-AI-Production` (`main`)  
**Supabase:** `CivicPulse-AI`, ref `ccrhdrjywnaccthzyjte`, Mumbai (`ap-south-1`)  
**Vercel:** `civicpulse-ai-production`

## 1. Executive summary

CivicPulse AI is an AI-assisted civic-issue reporting and municipal dispatch workflow. Residents submit a photo, category, description and coordinate. The service validates the upload, asks an AI model for assistive classification and severity/priority estimates, consolidates same-category reports in a 15-metre radius, and exposes a ticket board. Authenticated users can vote/comment; staff/admin can change ticket workflow and submit after-repair evidence. A staff member—not the model—confirms resolution.

The production architecture is **React/Vite on Vercel → Supabase Edge Function → Supabase Postgres/PostGIS/Auth/Storage**, with an optional FastAPI vision service intended for a separate container host. The Express/Mongoose service remains in the repository for local/legacy use; deployment documentation explicitly says it is not the production data source.

The live platform resources exist and are healthy at their control-plane level. The latest Vercel production deployment is READY, the Supabase project is ACTIVE_HEALTHY and its `civicpulse-api` Edge Function is ACTIVE (version 14; gateway `verify_jwt=false`). A direct HTTP request to the website and Edge Function health routes could not be completed from the assessment environment: outbound DNS resolution failed. Do not interpret control-plane status as a successful end-to-end test.

**Overall assessment:** viable prototype / early pilot foundation, not yet launch-ready for broad public municipal use. Critical correctness, image privacy, model dependency, abuse-control and operational gaps remain.

## 2. Scope, evidence and confidence

### 2.1 Systems inspected

- GitHub: `CivicPulse-AI-Production` and the older `CivicPulse-AI` repository.
- Git source: README, deployment guide, hackathon brief, frontend source/config, legacy backend, FastAPI vision source, Supabase migrations and Edge Function source.
- Supabase: project metadata, live table catalogue/counts, RLS policies, indexes, enum types, selected function definitions, storage bucket metadata, migration history, Edge Function status and Security/Performance advisors.
- Vercel: project metadata, production deployment state/details, deployment history and environment-variable metadata (values not copied into this report).
- Canva: searched for CivicPulse/CivicPulse AI references; no matching design/specification was returned.
- External API docs: official OpenAI, Supabase and OpenStreetMap Foundation documentation.

### 2.2 Specification-source limitation

No independent “CivicPulse AI master specification” file was found in the production repository or connected Canva search. `CIVICPULSE_CLAUDE_BRIEF.md` is explicitly a **hackathon project brief**. Its implementation-status section describes an earlier MongoDB/YOLO prototype and even states that map markers, live updates, durable photo handling and real resolution verification were incomplete. The newer `DEPLOYMENT.md` and live Supabase state describe a substantially newer implementation. This report uses the latter for current state and retains the old brief only as historical scope context.

### 2.3 Confidence labels

- **Verified:** directly returned by connected GitHub/Supabase/Vercel tools or inspected in repository files.
- **Documented:** stated in tracked documentation/source but not exercised through a live request.
- **Unverified:** requires credentials, direct HTTP execution, a test account, external provider status, or a pilot.

## 3. Workspace and repository audit

### 3.1 Repository selection

| Repository | Finding | Decision |
|---|---|---|
| `ankushdixit0001/CivicPulse-AI-Production` | Supabase migrations, production Edge Function, production deployment guide, current frontend and current vision service | **Selected source of truth for this audit and docs** |
| `ankushdixit0001/CivicPulse-AI` | Earlier prototype/brief; Node + Mongoose flow, older AI/vision assumptions | Historical reference only; do not modify |

The selected repository is public and the connected GitHub identity has push/admin permission. The production repository's current default branch is `main`. A docs-only change is intended; no application source is changed.

### 3.2 Stack observed

| Layer | Current / observed | Notes |
|---|---|---|
| Web client | React 18, Vite 5, React Router 6, Tailwind 3, Leaflet/React-Leaflet | Single-page routes: landing, report, command center |
| API/BFF | Supabase Edge Function `civicpulse-api` (Deno/TypeScript; supabase-js 2.57.4) | Production request path |
| Identity | Supabase Auth | Email/password UI; bearer token sent to Edge Function |
| Data | Supabase Postgres 17.11, PostGIS | Live source of truth |
| File storage | Supabase Storage | `civic-issue-images`, public bucket, 8 MiB cap, JPEG/PNG/WebP |
| AI vision | FastAPI container source, OpenAI `gpt-4.1-mini`, optional generic YOLO context | External container deployment not confirmed |
| AI fallback | Edge Function calls `https://api.llmfaucet.dev/v1/chat/completions`, model `auto:smart`, when external vision URL is absent | Community gateway; no provider SLA/contract verified |
| Legacy API | Express 4, Mongoose 8, MongoDB, Socket.IO | Local/legacy only; not production persistence |
| Web hosting | Vercel Vite project, root `frontend-app`, build `vite build`, output `dist` | Latest production deployment READY |
| Container hosting | `render.yaml` defines a free-plan Docker web service | Render deployment not confirmed |

### 3.3 Repository/documentation inconsistencies

1. The README says the Supabase schema is a separate foundation and later lists “Supabase is not yet the live API persistence layer” as a limitation. The deployment guide says the live frontend uses the Supabase Edge Function for reports, lists, auth, votes, comments, staff workflow and repair evidence. Live project state supports the latter.
2. `supabase/README.md` says to use a private Storage bucket before production; the actual bucket is public and `DEPLOYMENT.md` describes public image URLs as intentional.
3. `CIVICPULSE_CLAUDE_BRIEF.md` says the map markers are placeholders, the report data is not durably stored, and resolution verification receives placeholder buffers. Those claims are stale relative to the newer production code and database.
4. `.env.example` still lists MongoDB, a staff token and Gemini/Google API keys for the legacy API. These are not a reliable list of production Edge Function or vision-container secrets.
5. Tracked migration names/timestamps do not match the live migration history exactly. The live project records an `index_foreign_keys` migration that is absent from the selected repository's migration tree. The checked-in migrations also have different timestamp prefixes from the applied versions. Reconcile before any subsequent schema deployment.

### 3.4 CI/CD and source linkage

The repository includes one GitHub Actions workflow for Python vision regression tests. It runs on vision-service changes and manually. No comparable frontend, Edge Function, RLS integration, API contract, or end-to-end CI workflow was found in the inspected tree.

The latest Vercel deployment is READY, but its returned deployment record did not include a Git source/commit. The connected Vercel Git deployment-context listing did not identify this CivicPulse project. A GitHub-to-Vercel automatic deployment connection is therefore **not confirmed**. Verify the project’s Git source and deployment commit in Vercel before relying on docs/application commits to trigger builds.

## 4. Live platform audit

### 4.1 Supabase project and Edge Function

- Project: `CivicPulse-AI`; ref `ccrhdrjywnaccthzyjte`; region `ap-south-1`; database version `17.11.0.003`; status `ACTIVE_HEALTHY`.
- Deployed Edge Function: `civicpulse-api`; status `ACTIVE`; version 14; `verify_jwt=false`.
- Function source creates a service-role Supabase client. Protected routes parse a bearer token, call Supabase Auth `getUser(token)`, and check the database profile role for staff/admin actions. Public report/read paths are intentionally available without a user JWT.
- Edge Function CORS currently returns `Access-Control-Allow-Origin: *`.
- The function implements health, AI health/analyze, `/me`, ticket list/report, issue comments/events/votes/status, repair evidence/confirmation and chat routes.
- Service secrets were not read or exposed during this audit. Presence and correctness of `AI_SERVICE_URL`, `AI_SERVICE_TOKEN`, and the vision container's `OPENAI_API_KEY`/token cannot be verified from the available metadata.

### 4.2 Live database inventory

Observed row counts are a point-in-time snapshot; they are not a performance benchmark.

| Table | Rows | RLS | Main purpose |
|---|---:|---|---|
| `profiles` | 1 | Enabled | Auth-linked role/display profile |
| `civic_issues` | 3 | Enabled | Civic ticket, location, priority and AI metadata |
| `issue_events` | 5 | Enabled | Workflow/audit history |
| `issue_comments` | 0 | Enabled | Resident/staff discussion |
| `issue_votes` | 0 | Enabled | One vote per user per issue |
| `civic_api_rate_limits` | 2 | Enabled | Service-role rate-limit counters |

Enums: `civic_issue_status` = Pending, Assigned, In Progress, Resolved; `civic_issue_severity` = LOW, MEDIUM, CRITICAL; `civic_user_role` = resident, staff, admin.

PostGIS geography (Point, SRID 4326) and spatial GiST indexing are present. The `civic-issue-images` bucket is public, limited to 8,388,608 bytes, and accepts `image/jpeg`, `image/png`, `image/webp`.

The live catalogue contains primary-key indexes plus issue status/time, zone/status, priority, reporter/time, assignment, spatial, comments issue/time and author, events issue/time and actor, votes user, and rate-limit key indexes. Supabase Performance Advisor returned eight candidate unused indexes. With only three issue rows and no comments/votes, this is too little representative traffic to justify removing them.

### 4.3 RLS policy summary

| Resource | Anonymous | Authenticated resident | Staff/admin | Notes |
|---|---|---|---|---|
| Issues | SELECT all; no direct insert | SELECT all; insert own | SELECT all; update workflow | Public issue disclosure is intentional in current policy |
| Profiles | No SELECT | Read all profiles; update own without changing role | Same | Profile display data is broad to signed-in users |
| Comments | No access | Read all; insert as self | Read all; insert as self | No edit/delete policy observed |
| Votes | No access | Read all; insert/delete own | Same | Unique (issue,user) |
| Events | No access | Read all | Staff/admin append as self | Edge Function service role bypasses RLS |
| Rate limits | No access | No access | No direct access | Service-role-only policy/grant |

All six public application tables have RLS enabled. The Edge Function service-role client bypasses normal RLS and therefore depends on its own route-level authorization and validation being correct. The `verify_jwt=false` gateway setting is consistent with public intake only if every protected route continues to validate tokens and roles in application code. Supabase documents the distinction between gateway verification and handler-level authorization: [Authorization headers](https://supabase.com/docs/guides/functions/auth-headers).

### 4.4 Security and performance advisors

- **Security Advisor:** one warning, `auth_leaked_password_protection` — leaked-password protection is disabled. Supabase documents this control as an Auth password-security option and notes plan availability. Enable it if the project plan supports it; otherwise document the compensating control and plan constraint.
- **Performance Advisor:** eight candidate unused indexes. Do not remove indexes based on a three-row issue table. Recheck after a realistic pilot and query-plan review.
- Profile roles are stored in the database. The documented promotion SQL changes a profile role using an email lookup. Promote through an authenticated administrative runbook with an audit record, not a public client endpoint.
- The bucket being public means any person holding an image URL can retrieve that object. The URLs are persisted in `ai_metadata` and returned by the Edge Function. This is a privacy/design decision, not merely a Storage setting.

## 5. Feature inventory — current evidence

| Capability | State | Evidence / qualification |
|---|---|---|
| Landing/report/command-center UI | Implemented | React routes and report form exist |
| Photo capture/upload and client compression | Implemented | Image input and preparation flow |
| Location pin and browser geolocation | Implemented | Leaflet click and geolocation; Nominatim lookup |
| Report validation | Implemented | Category, description, coordinates, file type/size/signature |
| Public report ingestion | Implemented | Edge Function, upload and RPC |
| Same-category duplicate consolidation | Implemented, concurrency edge case | 15 m PostGIS check and merge counter |
| AI photo classification | Partially available | OpenAI-backed FastAPI source; deployment/secret availability unverified; Edge fallback is community inference |
| Image-quality checks | Implemented in vision source | Blur, brightness, contrast, resolution |
| Generic YOLO object context | Optional | Not a civic-defect classifier |
| Priority/severity estimate | Implemented as assistive estimate | Model-derived/heuristic; no measured accuracy evidence |
| Command-center issue board/map | Implemented | Map reads issue GeoJSON; frontend filters/refresh behaviour needs functional test |
| Auth | Implemented | Supabase Auth flow in UI/API; session lifecycle hardening needs validation |
| Voting/comments | Implemented | Edge endpoints and tables |
| Staff status update | Implemented | Staff/admin guard; assignment semantics need refinement |
| Before/after evidence upload | Implemented | Evidence stored; verification output retained |
| Human resolution confirmation | Implemented | AI recommendation is not sufficient alone |
| AI/chat assistant | Implemented with uncertain upstream | Community fallback; FastAPI route if configured |
| Realtime updates | Not verified/observed as production path | Legacy Socket.IO exists; frontend does not establish a Socket.IO subscription; deployment docs describe polling |
| Push/email/SMS notifications | Not in inspected production scope | No verified provider integration |
| Department/ward/SLA routing | Not complete | Zone defaults to `unassigned`; operational ownership not modeled |
| CAPTCHA/robust bot protection | Not confirmed | Deployment docs list anti-abuse controls as remaining work |
| Model quality measurement | Not available | No representative, labelled civic-damage evaluation set or metric report found |

No accuracy, impact, city adoption, time-saving, or service-level claim should be made until measured in a pilot.

## 6. Defects and priority findings

### P0 — resolve before real public data / production pilot

**P0-1 — resolution audit event rejected.** Live constraint `issue_events_event_type_check` allows `created`, `merged`, `status_changed`, `assigned`, `resolution_submitted`, `resolution_verified`, `commented`; the Edge Function inserts `event_type='resolved'` after confirmation. The `addEvent` helper catches/logs insert errors. Consequently the issue may transition to Resolved while the terminal audit event is absent. Add the allowed event type via a reviewed migration, make the state transition and event append atomic, and test both AI-pass and manual-override paths.

**P0-2 — image privacy policy is unresolved.** Public Storage bypasses read access checks for objects. Decide whether civic photos are intentionally public, provide privacy notice and redaction workflow, and remove or blur sensitive people/plates/address details where appropriate. Safer default: private bucket, explicit signed delivery for approved public thumbnails, strict upload ACL, and retention/deletion schedule.

**P0-3 — AI provider state is ambiguous.** The Edge Function may report a “configured/available” community inference mode when the FastAPI URL is unset, but this is not a guaranteed successful inference or SLA. FastAPI uses OpenAI only if configured; it requires `OPENAI_API_KEY` and `VISION_API_TOKEN`. Confirm the configured provider and perform authenticated image-inference and repair-verification smoke tests before calling AI operational.

**P0-4 — public intake abuse and privacy.** Intake is anonymous by design and rate limited to five reports/hour per user/IP by a database counter; AI endpoints/chat are limited to 20/hour. CAPTCHA is not confirmed. Ensure client-supplied forwarded IP headers cannot be trusted as authoritative, add bot controls/monitoring, review public issue location/description disclosure, and add retention/abuse-report handling.

### P1 — before feature expansion

- Reconcile missing live `index_foreign_keys` migration and timestamp mismatch.
- Fix duplicate merge concurrency when no candidate row exists: `SELECT ... FOR UPDATE` cannot lock a non-existent match. Add a serializable/advisory lock or another tested conflict strategy per spatial/category key.
- Ensure vote counter cannot drift under concurrent trigger execution; prefer atomic increment/decrement with reconciliation, or compute counts from source rows.
- Avoid setting `assigned_to` to the acting staff member for every status change; model explicit assignment and status transition.
- Stop swallowing audit-write failures for security-relevant state transitions.
- Use bounded server pagination (not accumulating up to 100,000 issue rows per request) and explicit sort/filter contracts.
- Use provider-backed/managed map tiles and geocoding with cache, quotas and monitoring for production scale.
- Add structured output validation and versioned prompts/provider/model metadata; keep human review mandatory.
- Test token expiry/refresh, logout, multi-tab session consistency, RLS, anonymous vs authenticated submissions, concurrent duplicates and concurrent votes.
- Configure CI for frontend lint/build/tests, Edge Function contract/integration tests, SQL migration checks, RLS tests and end-to-end paths.
- Confirm GitHub/Vercel deployment linkage and record the SHA of every production release.

### P2 — scalability and product maturity

- Normalize issue evidence and AI assessments into versioned child entities when multi-image/versioned model history is required.
- Add formal departments/wards, assignments, SLA policies, escalation rules and notification preferences after a municipal pilot defines operational ownership.
- Consider Supabase Realtime Broadcast/Database Changes for board updates; do not treat the legacy Socket.IO server as a production real-time service.
- Add accessibility/localization and mobile usability tests; validate actual civic category coverage and local language requirements.

## 7. Audit decisions

1. **Use Production repository:** `CivicPulse-AI-Production` is the main line; keep old `CivicPulse-AI` as archive/reference.
2. **Single source of truth:** Supabase Postgres is the production system of record. Do not activate MongoDB as a second write source.
3. **Keep Express/Mongoose out of production request path:** either archive it or retain as isolated local legacy code until an explicit removal decision.
4. **Use Edge Function as BFF for current scale:** modularize handlers and shared validation, but do not add another HTTP API unless a measured workload requires it.
5. **Keep model advisory:** AI cannot independently assign/resolve civic work or assert verified repair.
6. **No unverified provider dependency for public image processing:** prefer an explicitly approved, key-backed provider; community inference remains dev/optional only.
7. **No live changes in this phase:** the database and runtime remain untouched by these docs.

## 8. Uncertainties / items requiring owner confirmation

- Where is the complete “master specification,” if it exists outside the connected repository/library?
- What cities, wards, departments and issue taxonomies are in the first pilot?
- Are reports intended to be anonymous? Are exact coordinates and photos public, and what is the retention period?
- Is the FastAPI vision container currently deployed on Render or elsewhere? Are its three required secrets configured?
- Is the free community LLM endpoint intentionally approved for resident data, and are provider terms/retention acceptable?
- Does the live Vercel project have a Git provider link, or are production builds manually deployed?
- Should staff assignment include departments, crews, shifts, SLA timers and escalation?
- What language(s) and accessibility standard must launch support?
- What are expected volumes, response-time targets, budget and service availability needs?

## 9. Verification limitations

The control-plane state was read through connected GitHub, Supabase and Vercel integrations. Direct GET checks against the public Vercel and Supabase Edge Function URLs were attempted from the execution environment but failed before HTTP (DNS resolution unavailable). Therefore this audit does not certify runtime reachability, external provider inference availability, authenticated user flows, the vision container, or end-to-end correctness. Those require a network-enabled smoke-test environment and dedicated test credentials.
