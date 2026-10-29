# CivicPulse AI — API and Provider Selection

**Review date:** 2026-10-29. Quotas, model IDs, free access and provider capability may change. Re-test each active task at deployment.

## 1. Recommendation

### No-key starting option

Use **llmfaucet** as an optional keyless community inference adapter, not as the only production provider. Its public repository documents an OpenAI-compatible gateway and anonymous access, and says the router checks image/JSON capability before selecting upstreams. However, its API compatibility table still labels the chat-completions endpoint as in progress and warns that shared free capacity may change, slow down or disappear; therefore it is **not considered proven until a live smoke test passes**. Its published anonymous allowance is 20 requests/day per IP. Image routing succeeds only when a compatible multimodal upstream is available. See the provider's current [documentation](https://github.com/llmfaucet/llmfaucet).

- Base URL: https://api.llmfaucet.dev/v1
- Chat completion path: /chat/completions
- Model selector: auto:smart for general reasoning; set a vision route only after testing.
- Key required: none for anonymous access; a placeholder bearer value may be needed by some clients.
- Reliability: best-effort with shared rate limits and changing upstreams.

A successful text chat probe does not prove image analysis or before/after comparison works. Track health separately for chat, vision analysis and repair verification. A capability is “available” only after a recent relevant probe or successful request.

## 2. Optional higher-confidence providers

| Task | Candidate | Credential | Why | Caveats |
|---|---|---|---|---|
| Image classification and repair compare | Google Gemini API, configurable Flash-family model | Server-side Google AI Studio key | Official docs currently describe free access to selected models and multimodal use | Requires account/key; model availability, quotas and data terms vary |
| Image classification and repair compare | Groq vision API, supported Qwen 3.6 family | Server-side Groq API key | Official docs list Qwen 3.6 27B with image + text input and JSON mode: https://console.groq.com/docs/vision | Requires key; verify current availability, quotas and terms |
| Image classification and repair compare | OpenAI vision API, model configured by environment | Server-side OpenAI API key | Official model docs list image input for supported models | Requires API credentials and billing; a ChatGPT subscription does not itself configure API access |
| Text help assistant | llmfaucet anonymous gateway | None | No-key starting path, OpenAI-compatible format | Shared capacity; not proof of vision or production SLA |
| Local image quality | OpenCV + Pillow | None | Deterministic image decoding, blur/brightness/contrast/resolution | Cannot identify civic defects by itself |
| Object context | Existing YOLO COCO model if enabled | None for local inference | Supplemental object context | Not a validated pothole/garbage/sewage/streetlight detector |
| Map rendering | Leaflet + OpenStreetMap-derived tiles | No key in current app | Existing integration | Public tile services have usage policies and capacity limits; choose a compliant provider at scale |
| Geolocation | Browser Geolocation API | None | No external key | HTTPS/user permission required; always provide manual pin placement |
| Address search | Adapter around a compliant geocoder | Depends on provider | Human-readable location lookup | Public Nominatim is not an SLA-backed autocomplete API; use only within current usage policy and avoid keystroke-by-keystroke requests |
| Authentication/database/storage | Supabase Auth, Postgres/PostGIS, Storage | Existing project config | Already the live source of truth | Service-role key stays server-side; monitor usage and RLS |
| Email alerts | Resend or another transactional mail provider | Server-side key | Mature notification delivery | Optional feature; requires setup and verification |

Provider credentials must never be put in browser VITE_ variables. Store secrets only in the AI service's environment or an appropriate server-side secret store.

## 3. Provider routing rules

Default order:

- **vision analysis:** configured Gemini/Groq/OpenAI vision provider if enabled and verified → llmfaucet vision route only if image capability passes → local quality-only result.
- **repair verification:** configured Gemini/Groq/OpenAI vision provider → llmfaucet only if two-image comparison is verified → unavailable/needs-human-review.
- **chat:** configured text provider → llmfaucet chat → grounded rules-based civic help.
- **image quality:** local OpenCV/Pillow, independent of generative AI.
- **maps:** browser geolocation and manual pin work without AI or geocoding.

For strict no-key hosting, local quality checks are dependable; chat may work; image analysis and repair comparison remain best-effort until their image capability is verified. This is more honest than declaring all features healthy because a gateway URL exists.

## 4. Internal provider interface

Each adapter should expose:

- provider identifier and configured model
- supports(task_type, media_count, structured_output)
- health_check(task_type) returning availability, last checked time, reason and model
- analyze_image(image, selected_category, schema_version)
- chat(messages, allowed_context, schema_version)
- compare_repair(before_image, after_image, schema_version)

Classify failures as timeout, rate-limited, upstream unavailable, unsupported capability, invalid response, safety refusal or configuration error. Never pass raw upstream errors to the browser.

## 5. Cost, privacy and reliability

- One provider request per task before switching; no blind parallel fan-out.
- Resize images before transmission; remove EXIF location metadata from public copies.
- Bound prompt lengths, response tokens, image count, file size, timeout and request frequency.
- Cache capability status briefly, but never present a stale probe as currently healthy.
- Use a short circuit-breaker cooldown after repeated transient errors.
- Respect Retry-After and rate-limit headers where present.
- Log safe provider/model/status/latency metadata, not secrets or raw image/prompt payloads.
- If inference is unavailable, save the civic report with AI unavailable; never block civic intake on generative AI.
- Do not use submitted photos to train or benchmark third-party models without transparent disclosure and consent.

## 6. References

- llmfaucet API description and limitations: https://github.com/llmfaucet/llmfaucet
- Gemini API models/pricing/free-tier terms: https://ai.google.dev/gemini-api/docs/pricing
- Gemini model guide: https://ai.google.dev/gemini-api/docs/models
- OpenAI model capabilities: https://developers.openai.com/api/docs/models
- Groq supported vision models and examples: https://console.groq.com/docs/vision
- Groq key setup: https://console.groq.com/docs/quickstart
- Supabase architecture: https://supabase.com/docs/guides/getting-started/architecture
- OpenStreetMap copyright and tile info: https://www.openstreetmap.org/copyright
- Nominatim usage policy: https://operations.osmfoundation.org/policies/nominatim/

These references describe documented access, not a guarantee that a model/account/region is live at deployment. Before promoting a provider, run `python scripts/smoke_test.py --base-url https://your-service.example --image ./sample.jpg --before ./before.jpg --after ./after.jpg` against the deployed FastAPI service and confirm each requested capability returns `status=success`. A chat-only test does not verify vision or repair comparison.
