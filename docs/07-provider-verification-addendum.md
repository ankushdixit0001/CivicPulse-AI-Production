# 07 — Provider Research Addendum and Verification Record

**Research date:** 2026-10-30  
**Scope:** Supplemental official-documentation research for provider choices and availability. This is a documentation-only addition; no provider was configured or called with credentials.

## 1. Executive decisions

| Capability | Candidate / decision | Evidence and caveat | Phase-5 disposition |
|---|---|---|---|
| Core data, identity, storage, API | Supabase Postgres/PostGIS, Auth, Storage, Edge Functions | Existing project is ACTIVE_HEALTHY; civicpulse-api is ACTIVE v14; database tables and RLS were read through the Supabase integration | Retain; fix security and migration drift first |
| Primary image reasoning | Existing FastAPI adapter with OpenAI vision; evaluate Gemini multimodal as a second adapter | Official model/image docs exist. No credentialed inference test was performed. Both require credentials for hosted use; free-tier terms and privacy need careful review | Keep provider interface; run a labelled evaluation before choosing production default |
| Low-cost experimental image reasoning | Gemini API free tier, subject to current model and region availability | Official pricing page lists free-tier input for some models, but free-tier data may be used to improve Google's products; this is a privacy and governance concern for resident photos | Development/test only unless data-use terms are accepted and user notice/consent are approved |
| Language assistant | OpenAI or Gemini paid/eligible free tier; OpenRouter as optional routing adapter | OpenRouter offers a unified API, but free model IDs are rate-limited and availability/model choice can change | Use only behind adapter; no production dependency on free model routing |
| Embeddings / semantic duplicates | pgvector in Supabase plus a replaceable embedding model | Supabase documents pgvector extension and vector similarity. Embedding model and dimensions must be pinned/versioned | Adopt pgvector only after choosing and evaluating an embedding model |
| Maps rendering | Keep Leaflet already used, or migrate to MapLibre if vector styling/scale justifies it | MapLibre is a renderer; it does not provide map tiles, geocoding, routing or data licensing | No immediate migration; separate renderer from data providers |
| Geocoding | Managed geocoder or self-hosted Nominatim; public Nominatim only for low-volume manual search | Public Nominatim limit is max 1 request/second, no autocomplete, identifiable User-Agent/Referer, attribution and caching | Prototype-only use on public endpoint; provider must be swappable |
| Basemap tiles | Contracted OSM-derived tile provider or self-hosted tiles for production | OSM public tile server has no SLA, requires attribution and caching compliance, and can block abusive use | Do not treat public OSM tiles as unlimited production CDN |
| Abuse protection | Cloudflare Turnstile | Free plan documented; server-side Siteverify is mandatory and tokens expire after 300 seconds / single use | Add server verification before broad anonymous intake |
| Web push | Firebase Cloud Messaging (FCM) | Official Web SDK and browser support documentation available; requires service-worker, permission and token lifecycle | Candidate; test supported browsers and consent |
| Email | Resend or another transactional email vendor | Provider credentials, sending-domain verification, quotas and regional/data terms need an account-level test | Choose after volume and deliverability requirements are known |

## 2. Vision and language provider detail

### 2.1 OpenAI API

Official documentation:
- [Images and vision](https://developers.openai.com/api/docs/guides/images-vision)
- [GPT-4.1 mini model](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
- [Pricing](https://developers.openai.com/api/docs/pricing)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

Repository evidence: `ai-vision-service/app/main.py` calls `https://api.openai.com/v1/chat/completions` using `gpt-4.1-mini`, bearer authentication, image input and JSON response format. The existing implementation also performs local image quality checks and normalizes model output.

Verification:
- An unauthenticated GET to `https://api.openai.com/v1/models` returned HTTP 401 through the available web fetch. This establishes that the host responds and requires authentication; it does **not** verify a key, model entitlement, billing, quota or successful inference.
- No authenticated image request was made.

Decision:
- Retain OpenAI as a supported adapter, not a hard-coded dependency.
- Store key only in the private AI runtime secret manager.
- Use structured output schema where supported, but validate all returned values locally.
- Do not claim civic-defect accuracy without a labelled evaluation set and human review.

### 2.2 Google Gemini API

Official documentation:
- [Image understanding](https://ai.google.dev/gemini-api/docs/image-understanding)
- [Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [API quickstart](https://ai.google.dev/gemini-api/docs/quickstart)

Fit:
- Supports image understanding and structured responses; official docs also describe object detection and bounding boxes.
- The official pricing page lists a free tier for selected models, but exact model availability, quotas and prices can change.
- The pricing page indicates that free-tier data may be used to improve Google's products. This is a material privacy distinction for photographs submitted by residents.

Decision:
- Include Gemini as a candidate adapter for evaluation and non-sensitive development data.
- Do not route identifiable citizen images to a free tier unless data-use terms, privacy notice, consent and retention implications have been explicitly approved.
- Verify model availability in the intended Google AI Studio account and deployment region before selecting an exact model ID.

### 2.3 OpenRouter

Official documentation:
- [Developer platform](https://openrouter.ai/developers)
- [Free models](https://openrouter.ai/collections/free-models)

Fit:
- OpenAI-compatible routing endpoint with access to multiple providers and fallback capability.
- The free-model catalogue is dynamic. Official free-model guidance states free variants are rate limited; current documented caps include 20 requests/minute and 50 requests/day for free variants, subject to account conditions and change.

Decision:
- Suitable for experimentation and non-critical text tasks, subject to current model terms.
- Not approved as the sole production vision provider.
- Do not assume all models support images, JSON schema, data retention guarantees or stable availability.
- An OpenRouter API key is still required, even when model pricing is $0.

### 2.4 Hugging Face Inference Providers

Official documentation:
- [Inference Providers](https://huggingface.co/docs/hub/models-inference)
- [Pricing and billing](https://huggingface.co/docs/inference-providers/pricing)

Fit:
- Unified access to hosted inference providers and models.
- Official pricing documentation states Free accounts receive $0.10 monthly credits (subject to change); usage beyond credits is pay-as-you-go when enabled.
- This is not unlimited free inference.

Decision:
- Useful for model evaluation and trying alternative embedding/classification models.
- Keep provider and model IDs explicit and versioned.
- Check model task support and provider availability at runtime; do not infer vision support from the model's presence in the Hub.

### 2.5 Self-hosted inference (Ollama / Transformers / dedicated model server)

Official documentation:
- [Ollama API](https://github.com/ollama/ollama/blob/main/docs/api.md)
- [Ollama vision capabilities](https://ollama.com/blog/vision-models)

Fit:
- Removes per-request third-party API billing when run on infrastructure controlled by the project.
- Still incurs compute, GPU/CPU, memory, hosting, bandwidth, operations and model licensing costs.
- Public deployment needs authentication, network isolation, concurrency limits and model lifecycle management.

Decision:
- Keep as a future option for predictable high-volume or privacy-sensitive workloads if infrastructure budget and model quality justify it.
- A free software license does not mean free inference infrastructure.
- Benchmark latency and accuracy on representative local hardware before committing.

## 3. Geospatial provider detail

### 3.1 MapLibre

Official docs: [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/).

MapLibre is an open-source WebGL map renderer. It is not itself a basemap, geocoder or routing API. A style URL, vector/raster tile source, attribution and service terms are still required.

Decision: current frontend already uses Leaflet/React-Leaflet. Keep it for the first implementation unless vector styling, rendering performance or product requirements justify migration. Keep map rendering behind a component boundary so the tile provider can change independently.

### 3.2 Nominatim

Official policy: [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/).

Policy constraints for the public endpoint:
- Absolute maximum of 1 request/second per application.
- No client-side autocomplete.
- Valid identifying User-Agent or Referer.
- Attribution and caching required.
- No systematic/bulk queries; public service may block use.

Decision: user-initiated manual lookup only for low-volume prototype use. Use a managed geocoder with a contractual quota/SLA or self-host Nominatim for broader municipal usage. Do not submit personal or confidential text.

### 3.3 OpenStreetMap tile service

Official policy: [Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/).

The public tile service is best-effort and may block access. The policy requires attribution and correct cache behavior, including respecting server cache headers (or at least seven days where headers cannot be read). Bulk prefetch/offline download is prohibited.

Decision: prototype-only. Production should use a contracted tile provider or self-hosted tile infrastructure with capacity planning.

### 3.4 Google Geocoding

Official docs:
- [Geocoding API](https://developers.google.com/maps/documentation/geocoding)
- [Usage and billing](https://developers.google.com/maps/documentation/geocoding/usage-and-billing)

Google Geocoding is pay-as-you-go and requires billing plus an API key or OAuth. It offers quota controls but is not a zero-key free replacement. Current pricing must be checked against India pricing and the actual billing account before adoption.

Decision: candidate managed provider if address quality, quota and budget justify it. Keep calls server-side where keys and restrictions require it.

## 4. Platform and operational APIs

### 4.1 Supabase Edge Functions

Official docs:
- [Edge Functions](https://supabase.com/docs/guides/functions)
- [Limits](https://supabase.com/docs/guides/functions/limits)
- [Background tasks](https://supabase.com/docs/guides/functions/background-tasks)

Relevant documented hosted limits include 256 MB memory, CPU-time constraints, wall-clock duration depending on plan and request idle timeout. Heavy/long-running image inference should remain in the Python container or a durable worker rather than being performed synchronously in the Edge Function.

Decision: Edge Function remains the API façade, authorization boundary and orchestrator. It should persist the report first and dispatch AI processing asynchronously.

### 4.2 pgvector

Official docs: [Supabase pgvector](https://supabase.com/docs/guides/database/extensions/pgvector).

Fit: store text/image embeddings and perform similarity search inside PostgreSQL. It is a database extension, not an embedding-generation API.

Decision: candidate for semantic duplicate detection. Choose an embedding model, dimensions, distance metric, index strategy and evaluation dataset before creating production columns/indexes.

### 4.3 Cloudflare Turnstile

Official docs:
- [Plans](https://developers.cloudflare.com/turnstile/plans/)
- [Server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)

Official docs describe a Free plan and require server-side Siteverify validation. Tokens expire after 300 seconds and are single-use.

Decision: add to anonymous report intake and potentially signup, but only after backend validation is implemented. Client-side widget success alone is not security.

### 4.4 Firebase Cloud Messaging

Official docs:
- [FCM for Web](https://firebase.google.com/docs/cloud-messaging/js/client)
- [Send messages](https://firebase.google.com/docs/cloud-messaging/send-message)

Fit: browser push notifications with a service worker and permission/token lifecycle. Requires HTTPS in production and server-side sending credentials.

Decision: candidate for web push. In-app notifications remain stored in PostgreSQL and must work even when push permission is denied.

### 4.5 Email provider

Resend docs: [Resend API](https://resend.com/docs/api-reference/introduction).

Decision: choose a transactional email provider only after confirming sender-domain verification, India delivery, free-tier quota, bounce/complaint handling, data processing terms and account-specific limits. No account-level delivery test was performed in this phase.

## 5. Verification record (what was actually checked)

| System | Check performed | Result | What it proves / does not prove |
|---|---|---|---|
| Supabase project | Connected Supabase project metadata | `ACTIVE_HEALTHY`, Postgres 17.11, region ap-south-1 | Control-plane project state; not full app E2E |
| Supabase database | Read-only table inventory | Profiles 1 row, civic_issues 3, issue_events 5, comments 0, votes 0, rate limits 2; all listed public tables RLS enabled | Schema/data snapshot only; not load/security test |
| Supabase Edge Function | Function listing | civicpulse-api ACTIVE v14, verify_jwt=false | Deployed status; does not prove every route works |
| Supabase Security Advisor | Read-only security advisor | Leaked-password protection disabled warning | Confirms a current Auth configuration warning |
| OpenAI API host | Unauthenticated GET /v1/models | HTTP 401 Unauthorized | Host reachable and auth required; no inference test |
| Vercel site | Direct URL open via available web fetch | Not accessible in this tool | Not evidence of outage; browser/network tool limitation |
| Supabase function URL | Direct health URL open via available web fetch | Not accessible in this tool | Control-plane ACTIVE status remains the only verified evidence |
| Nominatim endpoint | Direct live query | Not accessible in this tool | Policy reviewed; endpoint request not verified |
| Gemini / OpenRouter / HF | Official documentation and pricing pages | Documentation accessible | API account, key, quota and inference not verified |
| OSM / MapLibre | Official docs/policies | Documentation accessible | Renderer and policy reviewed; tile/geocode service runtime not tested |

## 6. Risks and unresolved provider questions

1. **Free-tier volatility:** free models, quotas, account credits and provider routing can change without a software release. Add provider health and a controlled kill switch.
2. **Resident image privacy:** photographs may contain faces, vehicle plates, home interiors or location metadata. Do not send them to a provider whose retention/training terms have not been reviewed.
3. **Model accuracy:** general-purpose vision models are not validated municipal defect classifiers. Build a labelled India-specific test set and evaluate precision/recall per category, false negatives, false positives and calibration.
4. **No-key does not mean no-cost:** hosted providers still need an account/API key; self-hosted models require compute and operations.
5. **Public geospatial services:** OSM public services are policy-limited and have no availability guarantee.
6. **Asynchronous processing:** do not couple report submission latency to slow AI inference. Use durable job state, retries, idempotency and terminal failure states.
7. **Vendor lock-in:** persist provider/model/prompt versions and normalize responses behind internal interfaces.

## 7. Go/no-go recommendations

- **Go:** Supabase as system of record; existing FastAPI vision boundary; provider abstraction; Leaflet initially; PostGIS proximity queries; pgvector as a future evaluated extension; Turnstile for abuse control.
- **Conditional go:** OpenAI/Gemini hosted vision after account, privacy and labelled-evaluation checks.
- **Experimental only:** OpenRouter free models, Hugging Face free credits and undocumented community gateways.
- **No-go for production dependency:** public OSM Nominatim autocomplete, public OSM tile service as an unlimited CDN, or an unverified community AI gateway.
- **No-go:** sending private/identifiable citizen evidence to a free-tier provider without privacy review and explicit product approval.

## 8. Sources

All sources below are official provider documentation or policy pages. Prices and limits are time-sensitive and must be rechecked before deployment.

- Supabase: https://supabase.com/docs/guides/functions
- Supabase limits: https://supabase.com/docs/guides/functions/limits
- Supabase pgvector: https://supabase.com/docs/guides/database/extensions/pgvector
- OpenAI vision: https://developers.openai.com/api/docs/guides/images-vision
- OpenAI model: https://developers.openai.com/api/docs/models/gpt-4.1-mini
- Gemini image understanding: https://ai.google.dev/gemini-api/docs/image-understanding
- Gemini pricing: https://ai.google.dev/gemini-api/docs/pricing
- OpenRouter: https://openrouter.ai/developers
- OpenRouter free models: https://openrouter.ai/collections/free-models
- Hugging Face pricing: https://huggingface.co/docs/inference-providers/pricing
- MapLibre: https://maplibre.org/maplibre-gl-js/docs/
- Nominatim policy: https://operations.osmfoundation.org/policies/nominatim/
- OSM tile policy: https://operations.osmfoundation.org/policies/tiles/
- Google Geocoding billing: https://developers.google.com/maps/documentation/geocoding/usage-and-billing
- Turnstile plans: https://developers.cloudflare.com/turnstile/plans/
- Turnstile validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Firebase Cloud Messaging: https://firebase.google.com/docs/cloud-messaging/js/client
- Resend API: https://resend.com/docs/api-reference/introduction
