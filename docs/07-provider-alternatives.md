# 07 — Provider Alternatives and Task-by-Task Selection

**Research date:** 2026-10-30  
**Purpose:** supplement the primary API feasibility report with alternatives for each external task.  
**Important:** documentation reachability is not proof that a credentialed production request works. No provider keys were available for authenticated inference, email delivery or push delivery tests.

## 1. Selection summary

| Task | Primary candidate | Alternative / fallback | Free status | Recommendation |
|---|---|---|---|---|
| Vision reasoning and defect description | Gemini API multimodal model | OpenAI vision; Hugging Face routed VLM; self-hosted model | Gemini has tier-dependent free quota; HF free credits are very small and subject to change; OpenAI paid | Run an evaluation bake-off on labelled civic images; choose one paid/approved primary and one tested fallback |
| Detection / segmentation | Self-hosted fine-tuned detector once dataset exists | Roboflow-hosted inference or HF Inference Provider | Hosting/inference limits and plans need account-specific verification | Do not use generic COCO detector as civic-defect ground truth |
| Language assistant / summaries | Gemini API | OpenAI or HF chat model | Gemini quota varies by model/tier; HF free credits not a production allowance | Keep task-specific adapter and data-grounding |
| Text embeddings | Gemini Embedding API or a local sentence-transformer | pgvector + locally hosted embedding model; HF feature extraction | API use may be quota/billing limited; local model has compute cost | Fix model/dimension before creating vector index |
| Image similarity | Local image embeddings (CLIP-family) or approved multimodal embedding API | Perceptual hash as low-cost candidate signal | Self-hosted avoids per-call provider fee but needs CPU/GPU | Combine with geo/time/category; never merge on similarity alone |
| Map rendering | MapLibre GL JS | Leaflet (already in app) | Library is open source; map data/tiles are separate | MapLibre does not supply production tiles |
| Forward/reverse geocoding | Contracted geocoder or self-hosted Photon/Nominatim | Google Geocoding API | Public OSM services restricted; Google is billable with India-specific pricing/quotas | Do not use public Nominatim for autocomplete or high volume |
| Routing / distance | Self-hosted OSRM/Valhalla or contracted provider | Google Routes API | Public demo endpoints are not a production guarantee | Use PostGIS for straight-line proximity; routing only where route distance matters |
| Transactional email | Resend | SMTP provider or another transactional email vendor | Resend pricing page lists a free tier with 3,000 emails/month and 100/day at research time | Verify sender domain, account limits, suppression and deliverability before launch |
| Browser push | Firebase Cloud Messaging | Standards-based Web Push (VAPID) | FCM has no per-message pricing stated in the reviewed docs; project setup/quotas still apply | Use opt-in device subscription and server-side send credentials |
| Abuse prevention | Cloudflare Turnstile | hCaptcha or rate limits/risk controls | Turnstile documentation describes free integration availability; confirm current account terms | Server-side Siteverify is mandatory; widget token alone proves nothing |
| Core auth/database/storage/realtime | Supabase | Self-hosted PostgreSQL stack | Existing project and usage-plan limits apply | Retain current source of truth; verify quotas and backup/restore |

## 2. Vision and language models

### 2.1 Google Gemini API

Official documentation:
- Image understanding: https://ai.google.dev/gemini-api/docs/image-understanding
- Rate limits: https://ai.google.dev/gemini-api/docs/rate-limits
- Embeddings: https://ai.google.dev/gemini-api/docs/embeddings
- API key setup: https://ai.google.dev/gemini-api/docs/api-key

Fit:
- Multimodal image input supports captioning, classification and visual question answering.
- Image input can be passed inline or through the Files API.
- Embedding API supports semantic similarity/search workflows.
- Model quota is based on project tier and model; limits can change and are visible in AI Studio.

Limitations:
- Requires a Google AI Studio API key; this is not a no-key endpoint.
- Free quota is not a guaranteed production capacity or SLA.
- Model availability and limits differ by region, tier and model.
- Image understanding is general-purpose; it is not proof of civic defect accuracy.
- Confirm data handling, retention and terms before sending resident-submitted images.

Decision: **candidate for a low-cost evaluation and possible primary multimodal provider**, conditional on a labelled-image benchmark, account quota confirmation, privacy approval and successful server-side smoke test.

### 2.2 OpenAI vision

Official documentation:
- Images and vision: https://developers.openai.com/api/docs/guides/images-vision
- GPT-4.1 mini: https://developers.openai.com/api/docs/models/gpt-4.1-mini
- Pricing: https://developers.openai.com/api/docs/pricing
- Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs

Fit:
- Already used by the repository's FastAPI vision service.
- Image input and structured response options fit the current normalized-analysis contract.
- Clear model documentation and published pricing.

Limitations:
- Requires API key and API billing; a ChatGPT subscription is not API credit.
- Actual image cost depends on image processing/token accounting and current pricing.
- No account-level key, billing or quota was tested in this phase.

Decision: **preferred key-backed candidate for compatibility with the current FastAPI service**, not a free provider. Keep the adapter replaceable and evaluate against Gemini before final provider lock.

### 2.3 Hugging Face Inference Providers

Official documentation:
- Provider/model capabilities: https://huggingface.co/docs/inference-providers
- Pricing and billing: https://huggingface.co/docs/inference-providers/pricing

Fit:
- Unified routing to multiple providers and open models.
- Provider matrix includes chat completion and vision-language model support for selected providers.
- Useful for testing model alternatives without operating GPU infrastructure.

Limitations:
- Current pricing documentation lists Free users with $0.10 monthly included credits, subject to change; this is experimentation credit, not a sustainable production free tier.
- Model availability depends on provider, task, hardware and account.
- Requires Hugging Face token for routed inference.
- Provider-specific model terms, latency, privacy and rate limits still apply.

Decision: **evaluation/fallback candidate only**, after choosing a specific model/provider pair and validating vision input, JSON conformance, latency and privacy.

### 2.4 Task-specific defect detector

Generic pretrained object detectors identify their training labels, not arbitrary road defects. The existing YOLOv8n COCO model must remain supplemental context only.

Before using a dedicated detector:
1. Obtain a legally usable dataset covering Indian road, drainage, garbage, streetlight and infrastructure conditions.
2. Define annotation taxonomy and label quality rules.
3. Split train/validation/test by geography/time to reduce leakage.
4. Measure per-class precision, recall, F1, confusion matrix and calibration.
5. Evaluate performance across daylight, rain, night, camera angle and phone quality.
6. Use human review for low-confidence or safety-sensitive cases.
7. Track model/dataset version and drift.

Hosted inference such as Roboflow or self-hosted YOLO/RT-DETR/segmentation models should be selected only after the dataset, licensing and cost model are known. No Roboflow production quota or account availability is asserted in this document.

## 3. Embeddings and duplicate search

Options:
- Gemini Embedding API: managed text/multimodal embeddings; API key and model-specific quota required.
- Hugging Face feature-extraction provider: model/provider-specific support and billing; verify task type.
- Local sentence-transformer / CLIP-family model: open-source deployment option with infrastructure and model-license review.
- PostgreSQL pgvector: stores and indexes vectors; it is a database extension, not an embedding-generation API.

Recommended duplicate pipeline:
1. PostGIS candidate retrieval within a configurable radius and time window.
2. Category compatibility and status filtering.
3. Text similarity from normalized descriptions.
4. Optional image embedding similarity.
5. Weighted score with feature provenance and algorithm version.
6. Staff review for merge/relationship decisions.

Do not create an embedding column/index until the embedding model, vector dimension, metric and migration/backfill plan are fixed.

## 4. Maps, geocoding and routing

### 4.1 MapLibre

Official docs: https://maplibre.org/maplibre-gl-js/docs/

MapLibre GL JS is an open-source browser map renderer for vector tiles. It is not a tile-data provider and does not remove the need for a tile style, attribution, caching policy and service agreement. Existing Leaflet can be retained for the initial iteration to avoid unnecessary rewrite.

### 4.2 Nominatim

Official policy: https://operations.osmfoundation.org/policies/nominatim/

Public endpoint policy includes a maximum of one request per second, identifiable User-Agent/Referer, attribution, no autocomplete, and no systematic/bulk querying. It is not suitable as an unrestricted geocoding backend for a growing municipal product.

### 4.3 Photon

Official project/API docs:
- https://github.com/komoot/photon
- https://github.com/komoot/photon/blob/master/docs/api-v1.md

Photon supports forward/reverse geocoding and location bias. The public demo server permits reasonable use but explicitly offers no availability guarantee and may throttle/ban extensive use. Self-hosting is possible but has meaningful infrastructure requirements and operational maintenance.

### 4.4 Google Maps Platform

Official docs:
- Geocoding: https://developers.google.com/maps/documentation/geocoding
- Geocoding usage/billing: https://developers.google.com/maps/documentation/geocoding/usage-and-billing
- Routes: https://developers.google.com/maps/documentation/routes
- India pricing: https://developers.google.com/maps/billing-and-pricing/pricing-india

Google Geocoding and Routes provide managed functionality but require API credentials and billing. India-specific price lists and free usage caps differ by SKU and can change. Apply API restrictions, server-side key handling where applicable, quota ceilings and budget alerts. Do not hard-code a price into the application.

### 4.5 OSRM

Official API docs: https://project-osrm.org/docs/v5.24.0/api/

OSRM exposes route, nearest, table, match, trip and tile services. The protocol is documented and can be self-hosted from OpenStreetMap extracts. Public demo endpoint availability and capacity are not a production SLA; self-host or contract for production traffic.

## 5. Email, push and abuse protection

### 5.1 Resend

Official docs and pricing:
- https://resend.com/docs
- https://resend.com/pricing
- https://resend.com/features/email-api

The pricing page at research time lists a free tier with 3,000 emails/month and 100 emails/day; plan limits can change. Use idempotency keys for retry-safe sends, verify a sending domain and configure SPF/DKIM/DMARC as instructed. Do not treat accepted-by-provider as inbox delivery; track webhook events and bounces.

### 5.2 Firebase Cloud Messaging

Official docs:
- Web client: https://firebase.google.com/docs/cloud-messaging/web/get-started
- Server environment: https://firebase.google.com/docs/cloud-messaging/server-environment
- Admin SDK send: https://firebase.google.com/docs/cloud-messaging/send/admin-sdk

Web push requires HTTPS, browser Push API support, service worker setup and VAPID configuration. Sending must occur from a trusted server using Admin SDK or HTTP v1 authorization. Store device subscription identifiers securely and support revocation. FCM documentation confirms message send API behavior but does not mean a message is guaranteed to be displayed or read.

### 5.3 Cloudflare Turnstile

Official docs: https://developers.cloudflare.com/turnstile/get-started/

The client widget issues a token; the backend must validate it with Siteverify. Tokens are short-lived and must be verified server-side. Keep secret key in server environment only. Turnstile complements, not replaces, IP/account rate limits, upload limits and abuse monitoring.

## 6. API verification status

The official documentation pages above were reachable during research. This establishes documentation availability only.

No authenticated request was made to Gemini, OpenAI, Hugging Face, Resend or FCM because the required account credentials were not supplied and this phase is not allowed to configure secrets. No production send, upload or inference was triggered.

The connected repository audit reports that direct HTTP health checks to the deployed Supabase function and Vercel domain failed before HTTP due to DNS resolution from that execution environment. Control-plane metadata showed Supabase project ACTIVE_HEALTHY, Edge Function ACTIVE, and latest Vercel deployment READY. These are not end-to-end application tests.

## 7. Provider selection gate

Before any provider is approved for production, run a controlled test from a non-production environment:
- Credential and region validation.
- One positive and one negative image per supported category.
- Blurry, dark, low-resolution and irrelevant-image cases.
- Structured response validity and schema rejection.
- Latency p50/p95, timeout and 429 behavior.
- Provider outage and fallback.
- Privacy/data retention and terms review.
- Per-task cost at pilot volume and projected public scale.
- Rate limit and concurrency test.
- Human reviewer agreement and false-positive/false-negative review.

Record evidence, test timestamp, model ID, provider ID, request ID and measured result. No provider should be described as production-ready before this gate passes.
