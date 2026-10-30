# CivicPulse AI — API Research Register
Research date: 2026-10-30 · Official-documentation review; authenticated POST smoke tests were not performed without owner credentials.

## Verification labels
- **Docs verified:** official provider documentation inspected.
- **Public GET smoke test:** simple unauthenticated GET responded.
- **Account test pending:** requires owner's API key/project/quota or a representative POST payload.
- **No SLA:** free/shared/public service must not be treated as production capacity.

## AI vision and language

### Google Gemini API — prototype candidate
Official docs:
- Image understanding: https://ai.google.dev/gemini-api/docs/image-understanding
- Rate limits: https://ai.google.dev/gemini-api/docs/rate-limits
- Billing: https://ai.google.dev/gemini-api/docs/billing
Docs confirm multimodal image input, image classification and visual Q&A, using inline image data or Files API. Quotas are per project and model/tier-specific (RPM, input TPM, RPD); active quotas must be checked in AI Studio and capacity is not guaranteed.
**Decision:** Candidate for first no/low-cost vision + language integration after an account-level POST smoke test and civic-photo benchmark. Free access is not unlimited.

### OpenAI API — optional paid provider
Official docs:
- Vision: https://developers.openai.com/api/docs/guides/images-vision
- Pricing: https://developers.openai.com/api/docs/pricing
Docs support image input using URL or base64 in vision-capable models; image tokens are billed. Documentation warns that models can make mistakes, including spatial/localization errors.
**Decision:** Optional paid quality provider if owner approves budget and supplies API billing. ChatGPT subscription does not imply API credits.

### Hugging Face Inference Providers — model discovery and experiments
Official docs:
- https://huggingface.co/docs/inference-providers
- https://huggingface.co/docs/inference-providers/pricing
Docs list hosted inference providers and monthly free account credits ($0.10 at research time, subject to change); extra use is pay-as-you-go. Exact model/provider support varies; verify image input and schema support per model.
**Decision:** Development evaluation/fallback candidate, not an unlimited production API.

### Self-hosted models
Evaluate open vision-language models and task-specific detection only after accuracy, license, hardware and latency benchmarks. YOLO COCO pretrained weights are generic object detection and are not validated for potholes/sewage/streetlight defects. A civic dataset and evaluation labels are required.

### Existing llmfaucet gateway
Current code calls https://api.llmfaucet.dev/v1/chat/completions with model alias auto:smart and bearer value free.
**Status: unverified and not approved for production.** This audit did not establish stable provider documentation, SLA, image modality guarantees, rate limits, privacy/retention terms or model version. Do not transmit sensitive citizen images until contract and data handling are reviewed.

## Embeddings
Supabase pgvector docs: https://supabase.com/docs/guides/database/extensions/pgvector
pgvector stores/searches embeddings in Postgres; it does not generate embeddings. Select a separate text/image embedding model, test extension availability and dimensions, then benchmark recall/latency. Begin with text embeddings for descriptions; image embeddings are optional.

## Maps, geocoding and routing

### MapLibre GL JS
Official docs: https://maplibre.org/maplibre-gl-js/docs/
Open-source TypeScript/WebGL map renderer using style documents and tile sources. It is not itself a tile, geocoding or routing provider.
**Decision:** Adopt MapLibre as rendering layer, after planned migration from current React-Leaflet; choose tile/style source independently.

### OpenStreetMap raster tiles
Policy: https://operations.osmfoundation.org/policies/tiles/
The OSM data is open, but public tile servers are donation-funded, best-effort and have no SLA. Usage, attribution and caching requirements apply.
**Verification:** Public GET for https://tile.openstreetmap.org/0/0/0.png returned an image in research environment.
**Decision:** Development/prototype only within policy. Production should use a hosted provider with suitable terms/SLA or self-host tiles.

### Nominatim
Policy: https://operations.osmfoundation.org/policies/nominatim/
Public service has limited capacity; absolute max 1 request/second, valid identifying User-Agent/Referer and attribution required.
**Verification:** Research tool could not access a sample public search request; endpoint availability is not confirmed here.
**Decision:** Low-volume pilot with cache and policy compliance only, or self-host/contract hosted geocoding for production.

### Photon
Project: https://github.com/komoot/photon
Candidate geocoder. Hosted endpoint limits, availability, data freshness and policy need separate verification. Self-host if production control is required.

### OSRM
API docs: https://project-osrm.org/docs/v5.24.0/api/
HTTP API supports route, nearest, table, match, trip and tile; coordinate order is longitude,latitude. Public demo service is not an SLA.
**Decision:** Optional routing engine; self-host or contracted provider for production. Routing is not a blocker for MVP report/map display.

## Notifications
- Resend API docs: https://resend.com/docs/api-reference/introduction — candidate transactional email provider; verify current quotas, sender/domain, deliverability, data region and plan before adoption.
- Firebase Cloud Messaging: https://firebase.google.com/docs/cloud-messaging/js/client — candidate browser push; requires Firebase project, service worker, consent and VAPID configuration. Push is best effort.
- Supabase Realtime: https://supabase.com/docs/guides/realtime — use for live UI updates where access/quotas fit; it is not a durable delivery ledger. Persist in-app notifications in PostgreSQL.

## Abuse/security
- Cloudflare Turnstile docs: https://developers.cloudflare.com/turnstile/ — candidate challenge for anonymous intake; server-side token verification required.
- Validate image signatures, decoded image dimensions and file sizes server-side. Consider malware scanning based on risk and operational cost.

## Provider decision matrix
| Task | Candidate | Cost posture | Docs | Live account test | Status |
|---|---|---|---|---|---|
| Vision | Gemini | eligible free quota, tier-specific | verified | pending | prototype candidate |
| Vision | OpenAI | paid | verified | pending | optional paid |
| Vision/text | HF Inference | small changeable free credit | verified | pending | evaluation |
| Vision | self-hosted open model | compute cost | model-specific | pending | benchmark |
| Embeddings | pgvector + embedding adapter | DB + model inference | verified | extension/account test pending | planned |
| Renderer | MapLibre | open-source library | verified | not applicable | adopt |
| Tiles | OSM public raster | free, no SLA | policy verified | z0 tile GET passed | prototype only |
| Geocoding | Nominatim | strict public policy | verified | query not accessible | pilot only |
| Routing | OSRM | self-host/demo | verified | pending | optional |
| Email | Resend | plan-dependent | docs referenced | pending | candidate |
| Push | FCM | project-dependent | docs referenced | pending | candidate |
| Realtime | Supabase | plan-dependent | docs referenced | not tested | adopt if quota fit |

## Provider test protocol before integration
1. Owner creates provider project and controls credentials.
2. Confirm model/API still available in official docs.
3. Confirm data retention/training and processing region.
4. Confirm free quota and billing caps.
5. Test minimal text request.
6. Test representative image request (for vision).
7. Validate output schema and malformed response.
8. Test 401/403/429/5xx and timeout.
9. Measure p50/p95 latency and cost on realistic data.
10. Test quota exhaustion and fallback.
11. Store dated test evidence and provider/model version.
12. Add contract tests; do not deploy based only on docs.

## Unresolved provider checks
Gemini model availability and account quota; HF exact model/provider support and credit; OpenAI billing/key; llmfaucet terms/privacy/uptime; Nominatim availability from production region; tile/geocoder SLA and pricing; Resend domain verification; FCM browser delivery; Supabase extension and plan quotas.
