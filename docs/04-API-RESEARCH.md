# CivicPulse AI — Target External API Research

**Date:** 2026-10-30 · **Status:** research baseline; provider selection is conditional.

This addendum complements [05-external-api-research.md](./05-external-api-research.md) and [07-provider-verification-addendum.md](./07-provider-verification-addendum.md). It focuses on a task-oriented provider architecture for the expanded product.

## 1. Provider matrix

| Capability | Candidate | Decision |
|---|---|---|
| Identity, DB, Storage, Edge API | Supabase | Retain as core |
| Spatial operations | PostGIS | Adopt |
| Semantic duplicate search | pgvector + versioned embedding model | Adopt after model/dimension benchmark |
| Map rendering | MapLibre GL JS | Preferred renderer |
| Map tiles | contracted OSM-derived provider or self-hosted tiles | Do not depend on standard OSM tile server for high-volume production |
| Geocoding | Nominatim low-volume only; managed/self-hosted alternative for scale | Provider abstraction and cache required |
| Vision reasoning | existing FastAPI adapter; evaluate hosted VLM provider and self-hosted open weights | Benchmark on labeled civic photos before approval |
| Language assistant | hosted LLM adapter or Ollama-hosted model | Select by language quality, privacy, latency and budget |
| Embeddings | local sentence-transformers/Ollama or hosted embeddings | Keep dimensions/model version fixed per index |
| Email | Resend or another transactional mail provider | Candidate; verify domain and delivery webhooks |
| Browser push | Firebase Cloud Messaging | Candidate; HTTPS, service worker and consent required |
| Abuse protection | Cloudflare Turnstile | Candidate; server-side token verification mandatory |
| Observability | Sentry/OpenTelemetry-compatible stack | Candidate; redact PII and image content |

## 2. Official documentation references

- Supabase Edge Functions and limits: https://supabase.com/docs/guides/functions and https://supabase.com/docs/guides/functions/limits
- Supabase Storage access control: https://supabase.com/docs/guides/storage/security/access-control
- Supabase pgvector: https://supabase.com/docs/guides/database/extensions/pgvector
- Hugging Face Inference Providers and pricing: https://huggingface.co/docs/inference-providers/en/index and https://huggingface.co/docs/inference-providers/pricing
- Ollama API and vision: https://docs.ollama.com/api and https://docs.ollama.com/capabilities/vision
- MapLibre: https://maplibre.org/maplibre-gl-js/docs/
- OSM tile policy: https://operations.osmfoundation.org/policies/tiles/
- Nominatim policy: https://operations.osmfoundation.org/policies/nominatim/
- Resend pricing/API: https://resend.com/pricing and https://resend.com/docs/api-reference/introduction
- FCM web docs/pricing: https://firebase.google.com/docs/cloud-messaging/web/get-started and https://firebase.google.com/pricing

## 3. Important capability distinctions

- MapLibre renders maps; it does not supply tile hosting, geocoding or routing.
- OSM data is open, but standard OSMF tile servers are best-effort and have no SLA.
- Public Nominatim is not suitable for autocomplete or bulk geocoding; policy imposes a maximum of one request per second and requires caching/attribution.
- Hugging Face image classification is not the same as visual reasoning. A classification endpoint cannot by itself prove damage severity or repair completion.
- Hosted inference free credits are limited and subject to change. "Free" is not "unlimited".
- Ollama is self-hosted; compute, storage, operations and model licensing still apply.
- FCM's no-cost messaging does not imply every associated Firebase/Google Cloud resource is free.
- Supabase Edge Functions have CPU/memory/time limits; heavy vision inference belongs outside the Edge runtime.

## 4. Provider adapter contract

Every adapter implements `health`, `capabilities`, `execute`, `normalize`, `classifyError` and (when possible) `estimateCost`. Metadata includes provider, model, version, task, prompt version, request ID, latency, usage, status and stable error code.

Router rules:
1. Match exact task/input capability (text vs image vs image-pair vs embedding).
2. Check provider health and tenant/global budget.
3. Apply deadline, bounded retry and circuit-breaker policy.
4. Never retry invalid request or auth failure.
5. Fallback only to a provider with equivalent capability.
6. Return unavailable if none is suitable; never fabricate successful analysis.

## 5. Verification status

Official documentation reviewed; actual authenticated inference, geocoding, email delivery and push delivery tests require provider credentials and real project configuration. Do not promote a provider to production until request/response fixtures, quotas, terms, privacy, latency and failure behavior have been verified.
