# CivicPulse AI — Provider Evaluation and Decision

**Research date:** 2026-10-30  
**Purpose:** Pick a working, replaceable provider per task without confusing free-tier access with production reliability.

## 1. Decision summary

**Keep the original CivicPulse FastAPI service as the only AI API exposed to the app.** It owns image validation, task routing, schema validation, provider fallback, health state, and audit metadata. The frontend and Supabase Edge Function must not call individual model vendors directly.

### Recommended provider policy

1. **Development/demo, non-sensitive inputs:** Gemini API using the stable model ID set in `GEMINI_MODEL` (recommended starting value: `gemini-3.8-flash`). Google's official model/pricing pages list a free tier for this model, with quotas and provider terms that can change. A Google AI Studio API key is required; “free tier” does not mean “no key.”
2. **Optional open-weight multimodal fallback:** OpenRouter with a model explicitly supporting image input, initially `nvidia/nemotron-3.5-super-vl:free`. It requires an OpenRouter API key, is rate-limited, and its model page warns against sending confidential or personal information. Use only after the app's data policy permits the image/content to be sent to that route.
3. **No provider key / all providers failed:** local image-quality analysis continues. Chat returns a grounded FAQ response only for supported known questions; otherwise it says generative chat is unavailable. Resolution verification returns “unavailable / manual review required.” No fake detection or automatic resolution.
4. **Production with potentially personal photos:** use a provider/service plan whose data-use, privacy, retention, regional processing and availability terms have been explicitly accepted, or deploy a vetted open-weight vision model in infrastructure you control. Do not route private evidence to a generic free shared inference service by default.

The provider IDs and model names stay configurable because model availability, quotas, terms and prices can change.

## 2. Capability matrix

| Task | Preferred | Fallback | No-key behavior | Important constraints |
|---|---|---|---|---|
| Image-quality checks | Local OpenCV/Pillow | None needed | Fully works locally | Quality ≠ defect detection |
| Defect category + evidence | Gemini multimodal | OpenRouter multimodal only when allowed | `partial`; quality only | Structured output must be validated; AI confidence is advisory |
| Civic help chat | Gemini text | OpenRouter text | Grounded FAQ or “unavailable” | Must use civic policy/issue context; no invented city-specific facts |
| Before/after repair comparison | Gemini multimodal | OpenRouter only if allowed by privacy policy; otherwise manual review | `unavailable`, manual review | Never auto-close from model output; staff confirmation required |
| Text translation | Same chat adapter with locale constraints | Alternate configured provider | Show original text / unavailable | Keep original as source of truth |
| Duplicate proximity | PostGIS `ST_DWithin` | None needed | Fully works locally | Spatial/category match is not proof of duplicate |
| Future semantic duplicate search | Embeddings + Postgres/pgvector | Location/category rules | Rule-based fallback | Only add after embedding model and retention review |
| Map and coordinates | Browser Geolocation + Leaflet | Manual coordinate/location input | Fully works when location is permitted | Never silently use a hard-coded coordinate |
| Reverse geocoding | Configurable geocoder adapter | Manual landmark/coordinates | Coordinates remain usable | Public Nominatim has strict limits and requires app identification/caching |

## 3. Provider review

### A. Google Gemini API — first choice for a low-cost prototype

**Why:** one API family can handle text and image input, so the same service adapter can implement chat, vision triage and image comparison. Google's current model page lists `gemini-3.8-flash` as stable; the pricing page shows a free tier for that model as of the research date. Check current model names and quota limits before deployment.

**Trade-offs:** requires a private API key; free-tier limits are not an SLA. The official pricing page currently indicates that free-tier content may be used to improve Google's products, while paid-tier content is not used that way. Therefore, do not send unredacted personal/confidential content over a free-tier route without explicit policy and user disclosure. Do not expose the key in React/Vite.

**Configuration:**
- `GEMINI_API_KEY` (secret, server only)
- `GEMINI_MODEL` (default may start at `gemini-3.8-flash`; override without code changes)
- `AI_PROVIDER_PRIORITY=gemini,openrouter`
- Separate task allowlist for `image_triage`, `chat`, `repair_verification`

Official references:
- [Gemini model list](https://ai.google.dev/gemini-api/docs/models)
- [Gemini API pricing and free/paid data-use distinctions](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini API billing tiers](https://ai.google.dev/gemini-api/docs/billing)

### B. OpenRouter — optional open-weight multimodal fallback

**Why:** OpenAI-compatible chat completions reduce adapter complexity and allow selecting a model based on the task. As of 2026-10-30, `nvidia/nemotron-3.5-super-vl:free` is listed as a free multimodal model accepting text, images and video. The provider can change free model availability/limits; never assume the alias or model stays available.

**Trade-offs:** requires an OpenRouter API key even for free models; free requests are capped and shared infrastructure is not a production SLA. The model listing explicitly warns against uploading confidential or personal information. “Open weights” describes the model, not where inference runs: this option sends input to an external hosted service.

**Configuration:**
- `OPENROUTER_API_KEY` (secret, server only)
- `OPENROUTER_VISION_MODEL=nvidia/nemotron-3.5-super-vl:free`
- `OPENROUTER_CHAT_MODEL` set separately if a cheaper text-only model is selected
- Provider fallback disabled for sensitive tasks unless policy explicitly allows it.

Official references:
- [Free model collection and current limits](https://openrouter.ai/collections/free-models/)
- [Nemotron 3.5 Super VL (free), modalities and data warning](https://openrouter.ai/nvidia/nemotron-3.5-super-vl:free)
- [OpenRouter pricing](https://openrouter.ai/pricing)

### C. Existing OpenAI adapter — compatible option, not the default

The current FastAPI implementation uses `OPENAI_API_KEY` and `OPENAI_VISION_MODEL`. Keep an OpenAI-compatible adapter during migration so an existing configured key continues to work. ChatGPT subscriptions do not automatically include API usage. Do not require this provider if the project is targeting a free demo, and do not use the OpenAI model name as if it were interchangeable with Gemini/OpenRouter model IDs.

Configuration:
- `OPENAI_API_KEY`
- `OPENAI_VISION_MODEL`
- Disabled if key is absent; no startup failure solely because this optional provider is missing.

### D. Public keyless community gateway — not an approved production dependency

The existing Edge Function refers to `https://api.llmfaucet.dev/v1/chat/completions` with a shared public bearer value. I did not establish a reliable official contract, SLA, durable quotas, privacy guarantee, or successful end-to-end image request for that path. A fixed public bearer value is not an application credential. It must not be considered a guaranteed AI provider or cause health checks to report that AI is live. Keep it disabled unless its current documentation, security model, terms, quotas, and real tests are reviewed.

### E. Local/open-source inference — long-term privacy-first option

A self-hosted open-weight model can remove the external inference key and allow tighter data control, but it still needs compute, model weights, a secure runtime, monitoring and evaluation. The repository's current YOLOv8n is a generic object detector, not a trained civic-defect classifier, and cannot replace visual reasoning by itself. Any local model must pass a labeled civic image evaluation before it is described as a defect detector. CPU-only free containers may be too slow or memory-constrained for a multimodal foundation model.

## 4. Routing and resilience rules

- Use task-specific configuration rather than one global “AI enabled” flag.
- `configured`: server secret exists.
- `reachable`: last bounded remote health/probe request succeeded.
- `capable`: current provider/model supports the required text/image modality and structured response contract.
- `available`: computed per task from a recent successful probe, allowed data policy, and validated configuration.
- Report last successful probe timestamp and sanitized error class. Never claim that an API is available just because its base URL is non-empty.
- Use connect/read timeouts; apply bounded retry only for temporary network or server errors; honor 429/quota responses and avoid rapid retries.
- Fallback order is per task. A provider disabled for privacy cannot be retried as a fallback.
- Validate outputs using Pydantic/JSON schema, clamp confidence/scores, enforce text length, discard invalid coordinates/bounding boxes, and mark the result for human review when uncertain.
- Never let provider responses set user roles, choose arbitrary URLs/tools, modify database records, execute SQL, or directly transition an issue to resolved.
- Record provider/model/status/latency and schema/prompt version for each run. Avoid logging images, secrets, or full user prompts.

## 5. Cost and privacy rule

A free-tier model is a sensible **demo** choice, not a guarantee of free indefinite production usage. Current quotas, availability, data handling, and pricing must be rechecked before each release. The app needs an explicit policy for user photos that might contain faces, license plates, address numbers, or other personal data. Resize and strip EXIF before provider calls, disclose external AI processing, and provide a manual-review path if external inference is not permitted.

## 6. What “working” means for release

No provider will be marked verified until all of these pass against the deployed service:
1. real remote health/model probe;
2. a labeled, non-personal test image with expected structured fields;
3. text-only chat request and unavailable fallback;
4. a synthetic/non-personal before/after image comparison;
5. provider 401, 429, 5xx, timeout, malformed JSON and missing-key cases;
6. secret-not-in-logs and secret-not-in-browser-bundle checks;
7. latency and rate-limit test at the intended demo load.

**Current verification status:** this document is an evidence-based selection, not a claim that the providers are already configured in Render or that remote inference has succeeded. Render/Supabase secret setup and live integration tests are separate release gates.
