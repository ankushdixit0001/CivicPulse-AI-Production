# CivicPulse AI — External API Research and Selection

**Research date:** 2026-10-30  
**Evidence standard:** Official provider documentation reviewed. Documentation availability is not proof of a successful authenticated API call. No user-specific provider credentials were available for authenticated inference tests.

## 1. Executive recommendation

Use a provider-adapter design and select providers by task rather than forcing one vendor to do everything.

| Task | Candidate | Recommendation | Verification state |
|---|---|---|---|
| Core DB/Auth/Storage/Realtime | Supabase | Retain as core platform | Official docs reviewed; existing project configured per repo docs |
| Spatial DB | PostGIS | Adopt | Official PostgreSQL/Supabase extension docs should be pinned in implementation |
| Semantic search | pgvector | Adopt conditionally | Supabase docs confirm extension and similarity search |
| Map rendering | MapLibre GL JS | Preferred renderer | Official docs reviewed |
| Map tiles | OSM-derived tile provider / self-host | Do not rely on public OSMF tile server for commercial/large production traffic | OSMF policy reviewed |
| Geocoding | Nominatim public service for low-volume user-triggered queries only; otherwise managed/self-hosted alternative | Provider abstraction mandatory | Official policy reviewed; max 1 request/sec and other constraints |
| AI vision | Hugging Face Inference Providers or a separately selected vision endpoint; self-host open weights for predictable control | Pilot, benchmark actual civic images before adoption | Official task and pricing docs reviewed; no authenticated image inference call executed |
| AI language | Hugging Face Inference Providers; Ollama self-host for controlled deployment | Pilot with benchmark and cost limits | Official docs reviewed; runtime not tested |
| Embeddings | local sentence-transformers/Ollama or hosted provider | Keep provider-neutral; version embedding model and dimensions | API docs reviewed; no quality benchmark |
| Email | Resend | Candidate for transactional email | Official pricing/API docs reviewed; no account/API key test |
| Web push | Firebase Cloud Messaging | Candidate for browser push | Official web setup docs reviewed; no Firebase project test |
| Abuse protection | Cloudflare Turnstile | Candidate | Needs official API verification during implementation |
| Error monitoring | Sentry | Candidate | Needs project/key configuration and data residency review |

## 2. Supabase

Official docs:
- https://supabase.com/docs/guides/functions
- https://supabase.com/docs/guides/functions/limits
- https://supabase.com/docs/guides/storage
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/ai
- https://supabase.com/docs/guides/database/extensions/pgvector

Findings:
- Edge Functions are TypeScript/Deno and suitable for authenticated HTTP APIs, webhooks and small orchestration tasks.
- Published limits include 256 MB memory, 2 seconds CPU time per request, and wall-clock limits that vary by plan (the current docs list 150 seconds Free / 400 seconds paid). This reinforces that heavy image inference belongs in a worker/container or hosted inference provider.
- Storage supports RLS-based access policies; service keys bypass RLS and must remain server-only.
- Supabase documents pgvector for storing embeddings and similarity search.
Decision: retain Supabase as system of record and API facade; move expensive/long AI work to worker/vision service.

## 3. Vision and language inference

### Hugging Face Inference Providers
Official docs:
- https://huggingface.co/docs/inference-providers/en/index
- https://huggingface.co/docs/inference-providers/pricing
- https://huggingface.co/docs/inference-providers/tasks/image-classification

Findings:
- Provides a unified API across multiple inference partners and supports chat completion, vision-language chat for selected partners, feature extraction and image classification depending on provider.
- The official pricing page states Free accounts currently receive $0.10/month in included credits, subject to change; usage beyond included credits is pay-as-you-go when enabled.
- The image-classification task API is not equivalent to visual reasoning. A generic image classifier may return labels but cannot reliably assess civic damage, repair state, or provide calibrated severity.
Decision:
- Use as an experimental adapter, not a guaranteed free production dependency.
- Select a vision-language model only after checking current provider/model support for image input and structured output.
- Benchmark on a labeled civic image evaluation set and track false-positive/false-negative rates.
- Never represent the free credit as unlimited free API access.

### Ollama
Official docs:
- https://docs.ollama.com/api
- https://docs.ollama.com/capabilities/vision
- https://docs.ollama.com/api/embed

Decision:
- Strong self-host/local development option for open-weight LLMs, vision-capable models and embeddings.
- It requires compute, RAM/VRAM and operational hosting; it is not a hosted free public endpoint.
- Run a small benchmark on available CPU/GPU hardware before committing model choice.
- Use only models whose license permits intended deployment.

### Existing repository AI
Current FastAPI service:
- Implements image decoding/quality metrics, optional generic YOLO context, OpenAI vision classification, chat and before/after verification.
- Current Python code checks `OPENAI_API_KEY`; absent key leads to partial image quality-only response, unavailable chat and unavailable repair verification.
- YOLOv8n COCO is generic object detection and must not be treated as a pothole/garbage/sewage classifier.
- The Edge Function has an additional public community endpoint fallback. This research did not verify its official API contract, terms, image support, service availability or privacy guarantees. Do not approve it as production until all are verified and a real test is run.

## 4. Geospatial providers

### MapLibre
Official docs: https://maplibre.org/maplibre-gl-js/docs/
- Open-source WebGL map renderer.
- Does not provide tile hosting, geocoding or routing by itself.
Decision: preferred renderer, independent of tile/geocoding vendor.

### OpenStreetMap tile service
Official policy: https://operations.osmfoundation.org/policies/tiles/
- OSM data is open, but the standard OSM tile servers are donation-funded, best-effort and have no SLA.
- The policy allows blocking without notice if usage harms service.
Decision: use a contracted tile provider or self-host for production; show attribution and allow provider switching.

### Nominatim
Official policy: https://operations.osmfoundation.org/policies/nominatim/
- Public service has limited capacity; maximum absolute rate is 1 request/second.
- Requires identifying User-Agent/Referer and attribution.
- No autocomplete; no systematic/bulk geocoding.
- End-user triggered moderate-volume requests can be acceptable with caching and proxying.
Decision: public Nominatim may be used only for deliberate low-volume user-triggered lookup, never as bulk/autocomplete geocoder. Production should be able to switch to a paid or self-hosted geocoder.

## 5. Notifications

### Resend
Official pricing: https://resend.com/pricing
- Current published free plan lists 3,000 emails/month and 100/day; pricing and eligibility may change.
- Requires account/domain setup and verified sender configuration for production deliverability.
Decision: candidate for transactional email; do not assume deliverability until domain and webhook tests pass.

### Firebase Cloud Messaging
Official docs:
- https://firebase.google.com/docs/cloud-messaging
- https://firebase.google.com/docs/cloud-messaging/web/get-started
- https://firebase.google.com/pricing
- FCM supports web clients using browser Push API and HTTPS; server sends via Admin SDK or HTTP v1.
- Firebase pricing page currently lists Cloud Messaging as no-cost, but other Firebase/Google Cloud resources can incur charges.
Decision: candidate for browser push; verify consent, service worker, VAPID and token lifecycle.

## 6. Provider adapter contract

Each adapter must implement:
- `health()`
- `capabilities()`
- `execute(task, input)`
- `normalize(response)`
- `classifyError(error)`
- `estimateCost(input)` where provider publishes enough information

Common metadata: provider_id, model_id, model_version, task_type, prompt_version, request_id, duration_ms, usage, cost_estimate, status, error_code.

Routing:
- Prefer provider with required capability and healthy status.
- Enforce per-tenant and global budgets.
- Use timeout and bounded retries only for retryable errors.
- Do not retry invalid requests or authorization failures.
- Fall back only to a provider that supports the exact task and input type.
- Return `unavailable` when no valid provider exists; never synthesize a successful AI result.

## 7. API availability verification

| Provider | Docs reachable in research | Public unauthenticated API probe | Authenticated request | Decision |
|---|---|---|---|---|
| Supabase | Yes | Not attempted | Existing app configuration documented; no end-to-end test here | Approved platform |
| Hugging Face | Yes | Not a useful inference test without token | Not attempted | Pilot only |
| Ollama | Yes | Local runtime not available in this audit | Not attempted | Self-host candidate |
| MapLibre | Yes | Library docs only | No key required for renderer | Approved renderer |
| OSM tiles | Yes | No tile throughput test | Not applicable | No SLA; not primary production dependency |
| Nominatim | Yes | No live geocode request | Public policy reviewed | Low-volume only |
| Resend | Yes | Not attempted | No key/domain | Candidate |
| FCM | Yes | Not attempted | No Firebase project credentials | Candidate |
| LLMFaucet endpoint in source | No verified official documentation in this research | Not attempted | Existing code uses a static bearer string; not validated | Not approved |

## 8. Open questions before implementation

1. What monthly budget, if any, is acceptable for AI inference?
2. Will the AI service run on a local GPU, a managed container, or hosted inference?
3. Is civic media intentionally public, or should photos be private until moderated?
4. Which municipalities/wards are in the initial launch scope?
5. Is email enough for MVP, or is browser push/SMS mandatory?
6. Which languages are required at launch (English/Hindi or more)?
7. What labeled dataset and human review process will evaluate model quality?

## 9. Research limitations

Documentation was reviewed on 2026-10-30. Provider terms, quotas, pricing and model availability can change. No API keys were available for authenticated provider tests; therefore this document does not claim successful live inference or delivery tests. Before implementation, rerun checks against the exact selected model/provider and save redacted request/response fixtures.
