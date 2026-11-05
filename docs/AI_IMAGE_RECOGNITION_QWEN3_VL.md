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