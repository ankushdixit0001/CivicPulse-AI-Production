# CivicPulse AI Image Recognition — Qwen3-VL

## Model decision

Use **Qwen/Qwen3-VL-4B-Instruct** as the initial general-purpose vision-language model for civic photo triage. The upstream Qwen3-VL repository is Apache-2.0 licensed and documents image understanding, visual grounding, OCR, and OpenAI-compatible serving. The 4B instruct checkpoint is the practical starting point; evaluate the 8B checkpoint later if a representative civic-photo benchmark shows a material quality gain.

Model card: https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct  
Upstream implementation and deployment guide: https://github.com/QwenLM/Qwen3-VL

This is a general vision model, not a model already trained and validated for municipal defects. Do not represent zero-shot predictions as confirmed findings. Build a labeled civic dataset and evaluate pothole, garbage, sewage/drainage, damaged streetlight, and unknown/no-defect classes before considering fine-tuning.

## Architecture

- Keep FastAPI vision service as the authenticated application-facing API.
- Run Qwen3-VL in a separate GPU-backed inference service using vLLM (Qwen upstream recommends vLLM >= 0.11.0 for Qwen3-VL).
- Connect using the OpenAI-compatible `/v1/chat/completions` API.
- Keep citizen-image processing disabled by default. Enable it only after the inference endpoint is private, authenticated, and covered by the data-processing/privacy review.
- Keep image bytes in memory; do not persist or log citizen photos or base64 payloads.
- Treat model-generated severity, priority, and bounding boxes as suggestions. Server-side validation and human review remain mandatory.

## Vision provider environment

Set these only after a private GPU inference endpoint is provisioned:

- `QWEN_VL_BASE_URL`: private endpoint base URL, ending in `/v1` (for example, `https://<private-host>/v1`).
- `QWEN_VL_API_KEY`: bearer credential accepted by that endpoint. Never commit it or share it in chat.
- `QWEN_VL_MODEL`: exact served model ID; default is `Qwen/Qwen3-VL-4B-Instruct`.
- `AI_PROVIDER_PRIORITY`: `qwen_vl` (or `qwen_vl,gemini` only if a reviewed fallback is explicitly wanted).
- `ALLOW_EXTERNAL_IMAGE_AI`: keep `false` until the endpoint is secured and the user explicitly approves image processing.
- `ALLOW_OPENROUTER_IMAGE_FALLBACK`: keep `false`.

The Qwen adapter intentionally requires both an HTTP(S) endpoint and an API key, and is image-task-only. It does not become available for chat or translation.

## Runtime constraint

The current Render vision service is a free CPU web service. It should not load Qwen3-VL weights itself. The model must run on a GPU-backed host with adequate VRAM; Render remains the authenticated API gateway. Do not attempt to download model weights into the free Render container.

## Validation plan

1. Unit-test provider selection, endpoint URL construction, image-only policy, and secret-required behavior.
2. Run inference against a private GPU endpoint using synthetic/non-sensitive sample images first.
3. Evaluate a held-out, consented civic dataset with per-class precision/recall, confusion matrix, false-positive rate, bounding-box IoU, latency, and cost.
4. Test blurry, dark, night-time, obstructed, duplicate, irrelevant, and no-defect images.
5. Require human review for uncertain predictions and all high-impact priority decisions.
6. Enable production image processing only after privacy review, evaluation acceptance, and explicit approval.

## Current implementation status

The FastAPI provider router has a Qwen3-VL adapter behind the existing image-processing policy. No GPU endpoint has been provisioned, no Qwen credentials have been configured, and no production image-processing policy has been enabled by this change.
## Application integration contract

The application-side request path is already present:

1. The citizen report form submits the image and selected defect category to the Supabase Edge Function `POST /tickets/report`.
2. The Edge Function stores the original image in the `civic-issue-images` bucket.
3. It forwards the uploaded file and selected category to the authenticated FastAPI `POST /analyze` endpoint using `AI_SERVICE_URL` and `AI_SERVICE_TOKEN`.
4. FastAPI validates the image, computes image-quality signals, and routes image reasoning through the provider adapter.
5. The Qwen adapter sends the inline image to the configured OpenAI-compatible Qwen endpoint. The result is normalized and server-side priority is calculated.
6. The Edge Function persists the AI result as metadata. If inference is unavailable, the report is still saved for manual review.

No Qwen weights should be loaded into the Render CPU gateway. The Qwen endpoint must be independently reachable from Render and protected by TLS and bearer authentication.

### Render environment configuration (only after a private endpoint exists)

- `QWEN_VL_BASE_URL=https://<private-gpu-host>/v1`
- `QWEN_VL_API_KEY=<endpoint-bearer-secret>`
- `QWEN_VL_MODEL=Qwen/Qwen3-VL-4B-Instruct`
- `AI_PROVIDER_PRIORITY=qwen_vl`
- `ALLOW_EXTERNAL_IMAGE_AI=true` — enable only after explicit privacy approval and endpoint verification.
- Keep `ALLOW_EXTERNAL_TEXT_AI=false` if Qwen is intended only for image analysis.
- Keep `ALLOW_OPENROUTER_IMAGE_FALLBACK=false`.

The provider adapter rejects non-loopback plain HTTP endpoints. Local development may use `http://localhost:8000/v1`; deployed endpoints must use HTTPS. Never put endpoint credentials in Git, notebook output, browser code, or chat.

### Application-side verification

Run the vision-service tests from the `ai-vision-service` directory:

```bash
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
```

The tests cover secure Qwen endpoint configuration, image-only privacy policy, server-side priority calculation, and mandatory human review. A passing unit suite does not replace an end-to-end inference test against the actual private GPU endpoint.

### Current integration status

- Supabase-to-FastAPI image forwarding: existing application path inspected.
- FastAPI-to-Qwen OpenAI-compatible provider adapter: implemented on the architecture branch.
- TLS restriction and bearer credential requirement: implemented.
- Mandatory human review for every image-triage result: enforced in FastAPI normalization.
- Unit tests: added, not yet executed in this environment.
- Live Qwen GPU endpoint: not provisioned.
- Production environment variables, Supabase deployment, and Render deployment: unchanged.
