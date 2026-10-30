# 05 — External API Research and Availability

**Research date:** 2026-10-30  
**Scope:** Providers and platform APIs found in the checked-in source/deployment configuration, plus official alternatives relevant to the existing workflow.

## 1. Provider decision summary

| Provider / API | Use in CivicPulse | Official docs / policy | Availability result | Recommendation |
|---|---|---|---|---|
| Supabase Auth, Postgres/PostGIS, Storage, Edge Functions | Identity, system of record, media and business API | [Supabase docs](https://supabase.com/docs/guides/getting-started/features) | Project ACTIVE_HEALTHY; civicpulse-api ACTIVE v14 | Keep as production core; harden role checks, media policy and audit writes |
| OpenAI API — gpt-4.1-mini | Vision and chat via FastAPI container | [Images & vision](https://developers.openai.com/api/docs/guides/images-vision), [model](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [pricing](https://developers.openai.com/api/docs/pricing) | Model is listed in official model docs and supports image input; credential/quota/live request not verified | Preferred key-backed vision provider; use strict structured output and spend controls |
| LLMFaucet community gateway | Edge Function fallback when AI_SERVICE_URL is empty | Source endpoint: https://api.llmfaucet.dev/v1/chat/completions; no dependable official API documentation/contract surfaced in this audit | Not availability-tested; no SLA, privacy, retention, quota or terms verified | Do not rely on this provider for resident images or production availability; feature-flag as experimental only |
| OSM Nominatim | User-entered address/landmark geocoding | [Official usage policy](https://operations.osmfoundation.org/policies/nominatim/) | Current frontend code is wired to public endpoint; live request not tested | Acceptable for low-volume prototype only with policy-compliant throttling/caching and attribution; choose a managed provider for production |
| OSM standard tiles | Leaflet basemap | [Official tile policy](https://operations.osmfoundation.org/policies/tiles/) | Tile URL in code; live tile request not tested | Prototype only; comply with caching/attribution; managed tile provider or self-host if traffic grows |
| GitHub REST API | Source control and docs repository updates | [Repository contents API](https://docs.github.com/en/rest/repos/contents) | Connected repository inspected; docs written via GitHub integration | Keep GitHub as code/design record; add branch protection and CI |
| Vercel deployment | Static SPA hosting | [Vite framework docs](https://vercel.com/docs/frameworks/frontend/vite) | Project exists; most recent production deployment status READY | Keep Vercel for web assets; confirm Git source linkage and release SHA traceability |
| Canva | No verified application/runtime integration | Connected design search for CivicPulse returned no match | No CivicPulse design reference located | Not a runtime dependency; use only if a separate visual/design deliverable is commissioned |

## 2. Supabase platform APIs

### 2.1 Auth

Current app uses Supabase Auth identity and sends the user's bearer token to the Edge Function. The function's platform JWT check is disabled (verify_jwt=false) to support anonymous report submission, so the handler must continue to validate a supplied bearer token with Auth and must enforce staff/admin role on every protected operation.

Official references:
- [Auth overview](https://supabase.com/docs/guides/auth)
- [Edge Function authorization headers and verify_jwt](https://supabase.com/docs/guides/functions/auth-headers)
- [Password security and leaked-password protection](https://supabase.com/docs/guides/auth/password-security)
- [CAPTCHA protection](https://supabase.com/docs/guides/auth/auth-captcha)

**Availability:** the live Supabase project and function are active in the control plane. No test signup, login, refresh or logout was performed, and no test credentials were used. The Security Advisor has a live warning that leaked-password protection is disabled. Enable it if the project plan supports it, and add CAPTCHA/anti-abuse controls before broad public intake.

### 2.2 Postgres/PostGIS and REST

Supabase exposes Postgres data through generated APIs, but this implementation uses the Edge Function as a backend-for-frontend (BFF) for public issue operations. PostGIS geography, ST_DWithin, and a GiST index support same-category proximity merge within 15 m.

References:
- [Supabase features — Postgres, auto-generated REST, PostGIS/Realtime feature overview](https://supabase.com/docs/guides/getting-started/features)
- [RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Database extensions](https://supabase.com/docs/guides/database/extensions)

**Availability:** live project/database metadata is ACTIVE_HEALTHY; six public application tables are present and RLS is enabled. No external anonymous or authenticated PostgREST request was attempted. The submit_civic_issue RPC is present and only granted to service_role. Preserve this boundary; do not grant direct anonymous writes to the table.

### 2.3 Storage

The live civic-issue-images bucket accepts JPEG, PNG and WebP with an 8 MiB cap and is marked public=true. Public buckets bypass read access controls for serving an object's URL. Supabase states private buckets enforce access control on downloads and support time-limited signed URLs.

Reference: [Storage bucket access model](https://supabase.com/docs/guides/storage/buckets/fundamentals).

**Decision:** private-by-default is the target design because citizen photos may contain faces, registration plates, homes or other personal information. However, the current product displays publicly accessible issue evidence. The owner must approve whether the public ticket experience needs redacted public renditions or fully public media. Do not flip the bucket in production until the front end, signed URL policy, legacy URLs, retention and rollback plan are ready.

### 2.4 Edge Functions

The function civicpulse-api is ACTIVE version 14 with verify_jwt=false. Its handler uses a server-side service-role client. Supabase docs explain that platform-level JWT verification and handler authorization are two distinct layers; the current public intake design is only safe when handler auth and role checks remain complete.

Reference: [Edge Functions](https://supabase.com/docs/guides/functions).

**Recommended pattern:** public route allowlist; bearer validation for optional user identity; strict requireStaff; RLS for exposed database paths; service-role only for server-controlled writes; no service key in Vite environment variables; CORS origin allowlist; consistent errors and rate-limit response.

### 2.5 Realtime

The legacy Node API contains Socket.IO, but the production frontend does not establish a Socket.IO client subscription in the inspected flow. If the command center needs near-real-time state, prefer Supabase Realtime (Postgres Changes or Broadcast) with publication/RLS rules and load testing. Until then, bounded polling with cursors is simpler and more predictable.

Reference: [Supabase Realtime — Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).

## 3. OpenAI vision API

### 3.1 Fit

The Python FastAPI source uses https://api.openai.com/v1/chat/completions, model gpt-4.1-mini, an API bearer key, JSON-object response formatting and a 45-second upstream timeout. It resizes/validates images, computes quality metrics, normalizes model fields and marks low-confidence/poor-quality results for human review. Generic YOLOv8 context is optional and explicitly not treated as civic-defect classification.

Official model documentation lists gpt-4.1-mini as a smaller/faster GPT-4.1 model, supports image input, and lists Chat Completions and Responses API endpoints. The model page shows text-token pricing of USD 0.40 / 1M input tokens, USD 0.10 / 1M cached input tokens, USD 1.60 / 1M output tokens at research time. Image inputs count toward input usage; actual per-image cost varies with image detail/size and token accounting rules. Re-check pricing on launch day.

References:
- [Images and vision](https://developers.openai.com/api/docs/guides/images-vision)
- [GPT-4.1 mini model page](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
- [API pricing](https://developers.openai.com/api/docs/pricing)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

### 3.2 Integration recommendation

- Keep OPENAI_API_KEY only in the FastAPI container's secret manager.
- Authenticate Edge Function → FastAPI with a long random service token; require it on every non-health route.
- Enforce 8 MiB upload cap and image dimension/pixel cap before inference.
- Use a strict JSON Schema/Structured Outputs response where supported; continue validating every model field in code.
- Include provider, model, prompt_version, inference status, latency and usage/cost metadata.
- Separate model confidence from priority; reject non-finite and out-of-range values.
- Use request timeout, bounded concurrency, circuit breaker and fallback state.
- Never let AI close a ticket. Staff confirmation and an immutable audit record are mandatory.
- Add a representative human-labelled civic image test set and per-category precision/recall/calibration before claiming model quality.

### 3.3 Availability

The official model documentation confirms model/API support at documentation level. The audit did **not** perform a paid API request, verify account billing, inspect the key or test quota. OPENAI_API_KEY, container deployment, VISION_API_TOKEN, and Supabase AI_SERVICE_URL/AI_SERVICE_TOKEN runtime configuration are unverified. render.yaml defines a service, but a Render deployment was not inspected.

The Edge Function fallback uses LLMFaucet when AI_SERVICE_URL is unset. Its health route can report the keyless-community-inference mode as configured/available without proving a fresh successful image inference. Do not treat that response as a provider health guarantee.

## 4. OpenStreetMap geocoding and map tiles

### 4.1 Nominatim

Frontend code issues an explicit search request to https://nominatim.openstreetmap.org/search with format=jsonv2, limit=5 and addressdetails=1. It is triggered by a user search action, not keystroke autocomplete.

Official policy for the public Nominatim server:
- Absolute maximum of 1 request per second; no heavy use.
- Requests must carry an identifying HTTP Referer or User-Agent.
- Attribution must be displayed.
- Systematic queries and autocomplete are disallowed on the public endpoint.

Reference: [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/).

**Recommendation:** retain only for low-volume prototype/manual search. Add server-side throttling, caching, identifiable application User-Agent and query deduplication; avoid autocomplete. For a public civic deployment, use a contracted geocoder with quota/SLAs or host an appropriately maintained geocoder. Respect ODbL obligations for any retained/exposed OSM-derived data.

### 4.2 Standard OSM tile server

Frontend map uses https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png. The official policy states tile service availability is best-effort with no SLA and that usage can be blocked without notice. It requires visible attribution, honoring caching headers and retaining cache for at least seven days where the cache cannot read server directives.

Reference: [OpenStreetMap Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/).

**Recommendation:** use the standard service only for prototype/low-volume use and follow the policy exactly. Before a city-wide public launch, move to an OSM-derived commercial tile provider with written quota/availability terms or self-host. Do not assume OSM data being open means the public tile server is a free production CDN.

## 5. GitHub and Vercel

### 5.1 GitHub

GitHub is the source of truth for code, migrations and this design package. GitHub's repository contents API supports creating/updating repository files; this package is committed under docs/ only.

Reference: [GitHub REST API — repository contents](https://docs.github.com/en/rest/repos/contents).

Recommended controls: protect main, require review for SQL/security changes, enable dependency and secret scanning, pin actions, and add CI for frontend/Edge/DB/E2E test sets. Production releases should record Git SHA and migration version.

### 5.2 Vercel

The current project is civicpulse-ai-production, framework Vite, Node 24.x, root directory frontend-app; deployment metadata reports the most recent production deployment READY and the project uses a vercel.app production domain. One of the ten recent deployment records had ERROR status; most recent is READY.

Only the public Supabase publishable key was listed in Vercel env metadata (values intentionally omitted). The Supabase URL is hard-coded in frontend source; the default API base points to the Supabase Edge Function. No OpenAI/vision secret should be in Vercel browser env.

The latest deployment record returned no Git source details; linked Git deployment context did not identify CivicPulse. Confirm the repository connection and actual deployed commit in the Vercel dashboard. Docs commits should not be assumed to deploy a new app build.

Reference: [Vercel Vite framework guide](https://vercel.com/docs/frameworks/frontend/vite).

## 6. Canva

The connected Canva design search for CivicPulse / CivicPulse AI returned no matching project specification, HLD or ERD. No Canva artifact is used as a source of truth, and no design was modified. Use GitHub Markdown/Mermaid for versioned architecture deliverables unless a separate visual brand/pitch deliverable is requested.

## 7. Availability verification ledger

| Item | Method | Result | What this does not prove |
|---|---|---|---|
| Supabase project | Connected control-plane project metadata | ACTIVE_HEALTHY | User auth or API endpoint succeeds |
| Supabase Edge Function | Connected deployed-function inventory | ACTIVE, version 14 | A real unauthenticated/authenticated GET/POST works |
| Vercel production deployment | Connected deployment metadata | READY | Current public domain can be reached from every network |
| OpenAI model/API | Official model and image documentation | Listed; image input supported | Account billing, key, quotas, request success and application secrets |
| Nominatim | Official service policy + source URL | Endpoint referenced by frontend; usage policy confirmed | Current HTTP health or permitted load for a real traffic profile |
| OSM tiles | Official tile policy + source URL | Tile URL referenced by frontend; no SLA documented | Live tile HTTP status or actual cache compliance |
| LLMFaucet | Source code only | No trustworthy official API contract or uptime evidence located | Endpoint health, inference quality, privacy, terms or availability |
| Vision container | Source/Render blueprint and deployment docs | Deployment source exists; deployment not confirmed | Container reachable, token/key set or model call succeeds |

Direct GET tests against the Vercel domain and Supabase function /health and /api/ai/health were attempted from the execution environment but failed before HTTP because DNS resolution was unavailable. No production POST requests or write operations were attempted. No test credentials or provider secrets were inspected.

## 8. Final provider decisions

1. **Supabase:** retain as primary DB/Auth/Storage/Edge platform.
2. **OpenAI:** approved preferred candidate for key-backed vision, conditional on owner budget/privacy approval, secrets, structured outputs and successful authenticated smoke test.
3. **LLMFaucet:** no-go for production resident photos until provenance, terms, privacy, SLA and availability are verified; no-go for safety-critical conclusions.
4. **Nominatim/OSM tiles:** prototype only unless policy compliance and expected traffic are demonstrated; otherwise select a managed provider.
5. **Vercel:** retain for the frontend; verify Git integration and exact deployed SHA.
6. **Canva:** no current product/runtime role.
