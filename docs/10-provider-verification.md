# CivicPulse AI — Provider and API Verification Register

**Verification date:** 2026-10-30  
**Branch:** `architecture/implementation-plan`  
**Purpose:** distinguish documented capabilities from credentials, quotas, service availability and end-to-end behaviour that still require testing.

## 1. Executive decisions

| Area | Recommended design | Evidence status | Gate |
|---|---|---|---|
| Identity and application database | Supabase Auth + PostgreSQL/PostGIS | Existing project and database observed active | Keep; add staging and tests |
| API boundary | Supabase Edge Functions (Deno/TypeScript) | Existing `civicpulse-api` v14 active | Keep; refactor and harden |
| Citizen evidence | Supabase Storage, private original objects | Official private-bucket and signed-URL support verified; current bucket is public | Do not flip production bucket before UI/media migration |
| Hosted AI vision | OpenAI `gpt-5.4-mini` candidate | Official model page lists image input, Chat Completions/Responses and Structured Outputs; no live key/quota test | Use adapter; test with labeled civic images and budget |
| Open-weight vision alternative | Qwen3-VL-8B-Instruct | Official Hugging Face model card says Apache-2.0 and documents image input / local inference options | Benchmark locally; hardware is not free |
| Geocoding | Provider adapter; public Nominatim only for low-volume, user-triggered prototype search | Official policy verified | Must cache, throttle, attribute, allow provider switching; no autocomplete |
| Map tiles | Provider adapter; OSM standard tiles only for compliant low-volume use | Official policy verified; best-effort/no SLA | Do not promise availability; add configurable provider |
| Email | Resend adapter as an optional pilot candidate | Official pricing/API pages show free 3,000/month and 100/day | Verify sender domain, data terms and delivery in staging |
| Push | Firebase Cloud Messaging | Firebase documents Cloud Messaging as no-cost | Device token, consent and delivery tests required |
| SMS | Defer until budget and India sender/DLT compliance are approved | No provider selected or tested | Do not send real SMS yet |

No provider credential, API call, model accuracy, free quota or SLA is considered verified merely because documentation exists.

## 2. Supabase platform

### 2.1 Current production integration

- Project `CivicPulse-AI`, region `ap-south-1`, Postgres 17.11, status ACTIVE_HEALTHY.
- Edge Function `civicpulse-api` is ACTIVE v14 and `verify_jwt=false`.
- Function source uses a service-role client. Protected handlers call Supabase Auth `getUser(token)` and query `profiles.role`. Since platform JWT verification is disabled to support anonymous intake, every protected handler must continue to validate the bearer token and authorize against the database-controlled role.
- Frontend must use a publishable key only. Service-role and AI secrets stay in server-side secret stores.
- Current public issue SELECT policy and public Storage media policy expose a deliberate public surface; use explicit DTO projections and privacy review before adding more fields.

### 2.2 Database workflow

Official Supabase Local Development Workflow:
https://supabase.com/docs/guides/local-development/cli-workflows

Recommended sequence:
1. Link a clean local workspace to the known project only for read/pull operations.
2. Pull the remote schema into a new baseline migration after checking CLI help and current CLI version.
3. Review generated SQL carefully; remote schema pulls can include statements caused by differences in local extension defaults.
4. Reconcile remote migration history against tracked files before adding new migrations.
5. Run `supabase start` and `supabase db reset` only against the local disposable database.
6. Use a separate staging project/branch for integration tests.
7. Review `supabase db push --dry-run` output before any remote migration promotion.
8. Never run `supabase db reset --linked` against production.

Supabase changelog review:
https://supabase.com/changelog?types=breaking-change

Relevant notices visible on the verification date:
- 2026-10-12: Supabase announced that a subset of outdated TLS 1.2 cipher suites will be disabled for project HTTP APIs on 2026-11-10. Keep supported TLS stacks/dependencies current.
- 2026-09-25: Postgres 15.19 / 17.11 minor release notes mention possible action for `ltree`, `btree_gist`, `pgcrypto` and custom operators. The CivicPulse database reports Postgres 17.11; inspect enabled extensions and any relevant index/encryption use before assuming no action is needed.

### 2.3 Storage privacy

Official references:
- https://supabase.com/docs/guides/storage/buckets/fundamentals
- https://supabase.com/docs/guides/storage/serving/downloads
- https://supabase.com/docs/guides/storage/security/access-control

Verified platform behaviour:
- Private buckets enforce access checks on downloads.
- Private objects can be served using an authenticated download or time-limited signed URL.
- Public buckets bypass access control for retrieval by anyone possessing the object URL.
- Signed URLs expire, but individual signed URLs cannot be revoked independently; deleting/moving/renaming the object or rotating signing keys has broader implications.

CivicPulse decision:
- Store original report and repair evidence privately.
- Authorize residents only for their own evidence where appropriate; authorized municipal staff can access evidence for their jurisdiction.
- If public incident cards require images, create a separately redacted/approved public rendition and expose only that rendition.
- Store object paths and media metadata in PostgreSQL, not durable public URLs.
- Migration must account for current public object URLs, frontend image rendering, Edge Function upload/download, cleanup and rollback. Do not change the live bucket until this path is fully implemented and approved.

## 3. Hosted AI provider

### 3.1 Existing code risk

The current Edge Function contains a direct fallback to `https://api.llmfaucet.dev/v1/chat/completions` using a generic public bearer value. Its service contract, privacy, retention, uptime, quota and terms were not verified. Current code can send resident images and repair evidence to this unverified external gateway when FastAPI is absent or fails.

**Decision:** remove this fallback from the production execution path. A missing/unavailable approved provider must return an explicit `unavailable` or `needs_review` result. Civic report submission must continue and staff must retain a manual workflow.

### 3.2 OpenAI candidate

Official references:
- Vision guide: https://developers.openai.com/api/docs/guides/images-vision
- GPT-5.4 mini model: https://developers.openai.com/api/docs/models/gpt-5.4-mini
- Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- Pricing: https://developers.openai.com/api/docs/pricing

Verified from official documentation:
- `gpt-5.4-mini` accepts image input and supports Chat Completions and Responses endpoints.
- Model documentation lists Structured Outputs support.
- Published text-token rates at verification time: USD 0.75 / million input tokens and USD 4.50 / million output tokens. Image input has separate tokenization/cost rules; actual image cost varies by model, detail and dimensions.
- The API does not provide a free model tier for this model in the published model availability table. Do not label hosted inference as free.
- OpenAI's current vision guide warns that models can make mistakes; image descriptions and estimates must be treated as fallible.

The existing `gpt-4.1-mini` integration is not the default recommendation: its official model page marks the model as deprecated. Plan a versioned migration to a currently supported model after staging evaluation.

### 3.3 Adapter contract

The FastAPI service should define a provider-neutral interface similar to:

- `analyze_image(image, category_hint, locale) -> VisionAssessment`
- `compare_repair(before_image, after_image, issue_context) -> RepairAssessment`
- `health() -> ProviderHealth`

Every assessment includes:
- provider ID, model ID, model revision, prompt/schema version;
- request ID, latency, token/cost telemetry where available;
- explicit status: `success`, `unavailable`, `rejected`, `needs_review`;
- validated category/severity suggestions, confidence, evidence and limitations;
- human-review flag (always true for workflow-changing civic decisions).

The provider adapter may not write issue status, assignment or resolution fields. Store immutable assessment rows in PostgreSQL through a trusted Edge/API/database transaction.

## 4. Open-weight / self-hosted AI alternative

### Qwen3-VL-8B-Instruct

Official model card:
https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct

Verified model-card details:
- License metadata: Apache-2.0.
- Image-text-to-text / multimodal model.
- Model card includes Transformers use and local serving examples, including OpenAI-compatible chat-completions serving with SGLang.

Operational implications:
- Weights are open and may be self-hosted, but inference is not cost-free: GPU/CPU hardware, memory, hosting, scaling, power, maintenance and monitoring are still required.
- Apache-2.0 does not establish civic-domain accuracy, acceptable latency, safe bounding boxes or suitability for municipal triage.
- Benchmark on a consented, locally representative, human-labelled dataset before production. Measure per-class precision/recall, calibration, false-negative rate for safety-critical issues, language robustness and drift.
- Pin model revision, container/runtime, tokenizer and inference server versions. Review model card and license at the exact revision used.

### Other local components

- OpenCV: deterministic image decoding, resizing, blur/brightness/contrast checks and preprocessing; it is not itself a semantic civic-defect model.
- PyTorch / Transformers: reusable inference runtime; not a pretrained civic classifier by themselves.
- YOLO: use only after selecting a specific model, reviewing its license and evaluating it on the target classes. Generic COCO object detection does not prove pothole/sewage/streetlight-defect recognition.

No open-weight model is approved as an accurate CivicPulse classifier until its benchmark passes the agreed acceptance threshold.

## 5. Geospatial services

### 5.1 Nominatim

Official policy:
https://operations.osmfoundation.org/policies/nominatim/

Verified constraints:
- Public Nominatim has an absolute maximum of one request per second.
- Requests must identify the application with a valid User-Agent or Referer and display attribution.
- User-triggered search is acceptable for moderate use; aggregate traffic across all users counts toward the limit.
- Caching and the ability to switch providers are required recommendations.
- Client-side autocomplete is explicitly prohibited on the public Nominatim endpoint.
- Do not submit personal or confidential information to the service.
- The public service has limited capacity and may change policy or withdraw access.

Decision:
- No keystroke autocomplete against public Nominatim.
- Debounced explicit search action only, strict server-side throttling and caching.
- Put geocoding behind a provider interface and configuration flag.
- Do not send citizen names, phone numbers, full issue narratives or images to geocoding.

### 5.2 OpenStreetMap standard tiles

Official policy:
https://operations.osmfoundation.org/policies/tiles/

Verified constraints:
- Standard OSM tile service is best-effort and has no SLA.
- Correct HTTPS tile URL, visible attribution, Referer/User-Agent identification and HTTP caching requirements apply.
- Bulk download, offline prefetch and forced tile scraping are prohibited.
- Policy recommends avoiding hard-coded tile URLs so the provider can be changed.

Decision:
- Keep tile provider configurable.
- OSM standard tiles may be used for a small prototype with attribution and normal browser caching.
- For public municipal scale, choose a contracted OSM-derived tile service or self-hosted tiles with a budget/operations owner.

## 6. Notifications

### 6.1 Email — Resend candidate

Official pages:
- https://resend.com/pricing
- https://resend.com/features/email-api

The published Free plan lists 3,000 emails/month and a 100/day cap. This is a provider plan quota, not a delivery guarantee. Verify sender-domain authentication, terms/data handling, webhooks, bounce handling and production limits before using for residents.

### 6.2 Push — Firebase Cloud Messaging

Official pricing:
https://firebase.google.com/pricing

Firebase lists Cloud Messaging as no-cost. This does not eliminate engineering work or device/browser permission requirements. Store device tokens and notification preferences in PostgreSQL; users must be able to opt out. Validate web push support, token rotation, service-worker behaviour and delivery receipts in supported browsers.

### 6.3 SMS

No SMS provider is approved. SMS has provider and carrier costs and India-specific sender/template compliance considerations. Keep SMS behind an adapter and disabled until sender registration, consent, budget and delivery tests are approved.

## 7. Required verification tests

| Provider | Contract tests | Staging smoke tests | Production gate |
|---|---|---|---|
| Supabase Auth | Signup/login/refresh/logout, invalid/expired token | resident/staff/admin role checks | session revocation and RLS review |
| Supabase Storage | MIME/signature/size, path ownership, signed URL expiry | resident vs staff object access | private originals and redacted public rendition |
| Edge Functions | route schema, CORS, auth and error envelope | every route and rate-limit boundary | secret scan and release SHA |
| OpenAI | adapter schema, timeout, refusal, malformed response | approved test images and usage telemetry | quota/cost alerts and human review |
| Qwen3-VL | runtime startup, schema adapter, memory and timeout | labeled image benchmark | documented hardware, license and quality sign-off |
| Nominatim | throttle/cache/provider switch | explicit user-initiated geocoding | no autocomplete; attribution and privacy review |
| OSM tiles | URL/config/attribution | browser cache and provider switch | capacity and no-SLA acceptance |
| Resend | payload schema, idempotency, webhook signature | verified test domain and bounce handling | opt-in, sender reputation and quota alert |
| FCM | token lifecycle and permission handling | supported browser/device push | opt-in, privacy and token cleanup |

## 8. Outstanding facts — do not infer

- OpenAI API key validity, billing, organization limits and current rate tier.
- FastAPI deployment health, public URL, model configuration and service token match.
- Whether Resend or Firebase projects are already provisioned for CivicPulse.
- Municipal data processing agreements, residency requirements, retention periods and consent language.
- Local model hardware and actual inference cost/throughput.
- CivicPulse-specific model precision/recall and bias across city, camera, lighting, weather and language conditions.

**Conclusion:** use Supabase as the data/auth/storage platform; keep FastAPI as the replaceable AI orchestration service; remove the unverified community inference fallback from production; evaluate GPT-5.4 mini against a self-hosted Qwen3-VL candidate; use OSM public services only within their published restrictions; and keep notification providers optional behind database-backed outbox adapters.
