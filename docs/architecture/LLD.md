# CivicPulse AI — Low-Level Design (LLD)

**Status:** Implementable design baseline  
**Date:** 2026-10-30  
**Parent:** [HLD](./HLD.md)

## 1. Package/service boundaries

### Frontend — `frontend-app/src`
- `api/client`: one typed wrapper for Edge Function routes, request IDs, error parsing, and timeouts.
- `features/report`: camera/gallery selection, image preview, size/type validation, location capture, consent, submission result.
- `features/issues`: feed, filters, pagination, map markers, detail, comments and votes.
- `features/command-center`: staff queue, issue detail, assignment, status transition, repair evidence and audit history.
- `features/ai-status`: renders server truth for each capability rather than a generic “AI online” flag.
- `features/accessibility`: form errors, keyboard navigation, live regions, focus management.
- Frontend rules: no provider API key, no direct service-role access, no hidden demo incidents, and no status mutation without server authorization.

### Supabase Edge Function — `supabase/functions/civicpulse-api/index.ts`
- `requestContext`: request ID, CORS, method and body size.
- `auth`: validate Supabase bearer token through Supabase Auth; resolve `profiles.role`.
- `validation`: normalize category, description, coordinates, file content type/signature, and allowed fields.
- `issueService`: create and query issues, duplicate linking, comments, votes, assignment, state transitions.
- `mediaService`: Storage upload, media metadata, signed URL generation.
- `aiClient`: only service-to-service HTTP calls to FastAPI using `AI_SERVICE_URL` and `AI_SERVICE_TOKEN`.
- `auditService`: append event for each accepted state transition.
- `rateLimitService`: database-backed per-account/IP rate limits.
- Domain logic is pure or testable; route handlers orchestrate and do not contain provider-specific prompts.

### AI service — `ai-vision-service/app`
Target module structure:
- `main.py`: FastAPI routes, authentication dependency, HTTP error mapping.
- `config.py`: environment-based settings, safe defaults, model IDs and timeouts.
- `schemas.py`: Pydantic request/response models and schema-versioned results.
- `providers/base.py`: common provider interface and error taxonomy.
- `providers/gemini.py`: native Gemini `generateContent` adapter.
- `providers/openrouter.py`: OpenAI-compatible `chat/completions` adapter, only when key and data policy allow it.
- `providers/openai_compat.py`: optional compatibility adapter for existing OpenAI deployments, not a required dependency.
- `services/image_quality.py`: local blur/brightness/contrast/resolution checks and EXIF stripping.
- `services/triage.py`: category reasoning, evidence extraction, conservative severity/uncertainty normalization.
- `services/chat.py`: grounded civic FAQ and provider-backed answer with anti-hallucination instructions.
- `services/repair_verification.py`: before/after visual comparison and conservative result normalization.
- `services/priority.py`: deterministic, versioned business rules.
- `observability.py`: safe structured logs, timing, provider health and request correlation.
- `tests/`: provider contract mocks, validation, failure behavior and route authorization tests.

The module split is a target structure. The current repository currently has most logic in `main.py`; implementation should migrate incrementally while preserving route compatibility.

## 2. API contract

Use JSON responses with `request_id` when relevant. Existing Edge Function routes remain supported during migration.

### AI service routes

| Method and route | Auth | Purpose |
|---|---|---|
| `GET /health/live` | none; no secrets | Process is alive only |
| `GET /health` | none; no secrets | Backward-compatible readiness and capability summary |
| `POST /analyze` | `x-civicpulse-ai-token` | Multipart: `file`, `defect_type`, optional `description`, optional `locale` |
| `POST /chat` | `x-civicpulse-ai-token` | JSON: `message`, optional `issue_id`, optional `locale` |
| `POST /verify-resolution` | `x-civicpulse-ai-token` | Multipart: `before_file`, `after_file`, `issue_id` |
| `GET /health/providers` | internal/admin only in production | Per-provider last probe, latency, capability and sanitized failure code |

### Normalized analysis response

```json
{
  "status": "success | partial | unavailable",
  "schema_version": "1.0",
  "request_id": "uuid",
  "provider": "gemini | openrouter | openai_compatible | local_quality | none",
  "model": "configured-model-id-or-null",
  "defect_type": "pothole",
  "detected": null,
  "severity": "low | medium | high | critical | unknown",
  "confidence": 0.0,
  "priority_score": 0,
  "visual_evidence": [],
  "recommended_action": "string",
  "photo_quality": {},
  "requires_human_review": true,
  "warnings": []
}
```

All model-originated values are validated and clamped. Missing values remain `null`/unknown. A photo-quality result is not a defect detection. A model error produces `partial` or `unavailable`, not a fabricated success.

### Repair verification response

```json
{
  "status": "success | partial | unavailable",
  "schema_version": "1.0",
  "provider": "gemini | openrouter | openai_compatible | none",
  "verified": false,
  "confidence": 0.0,
  "before_damage_pct": null,
  "after_damage_pct": null,
  "evidence": [],
  "reason": "string",
  "requires_staff_confirmation": true
}
```

No response from the model directly sets an issue status. The API only stores the assessment and evidence; the staff user makes the final transition.

### Stable error envelope

```json
{
  "error": {
    "code": "AI_PROVIDER_UNAVAILABLE",
    "message": "AI analysis is unavailable; your report was still saved.",
    "retryable": true
  },
  "request_id": "uuid"
}
```

Do not expose provider URLs containing credentials, prompt internals, stack traces, or secrets.

## 3. Public Edge API contract

| Route | Role | Operation |
|---|---|---|
| `GET /tickets` | public | Paginated ticket list with status/category/zone/priority filters |
| `POST /tickets/report` | public or authenticated | Validate, store media, run local checks/AI triage, detect duplicate candidate, persist ticket/report and event |
| `GET /tickets/:id` | public for public fields | Ticket details and safe media URLs |
| `GET /tickets/:id/comments` | public for public tickets | List comments |
| `POST /tickets/:id/comments` | authenticated | Add validated comment |
| `POST /tickets/:id/vote` | authenticated | Idempotent per-user vote |
| `GET /tickets/:id/events` | public safe timeline; internal metadata restricted | Read sanitized event history |
| `PATCH /tickets/:id/status` | staff/admin | Validate allowed transition, add audit event |
| `POST /tickets/:id/resolve` | staff/admin or authenticated evidence submitter per policy | Upload after-repair evidence and request AI verification |
| `POST /tickets/:id/resolve/confirm` | staff/admin | Explicitly confirm/override with reason |
| `GET /api/ai/health` | public sanitized capability state | Truthful provider readiness |
| `POST /api/chat` | rate-limited | Civic help chat with safe fallback |

A versioned `/v1` prefix is recommended for future breaking API changes; current routes remain as compatibility aliases until all clients migrate.

## 4. Report creation sequence

```mermaid
sequenceDiagram
  actor Resident
  participant Web as React App
  participant Edge as Supabase Edge API
  participant Vision as FastAPI
  participant DB as Postgres/PostGIS
  participant Store as Supabase Storage
  Resident->>Web: Add description, photo and location
  Web->>Edge: POST report (multipart/form data)
  Edge->>Edge: Validate size, signature, coordinates, rate limit, idempotency
  Edge->>Store: Store photo in allowed bucket
  Edge->>Vision: Analyze photo (service token)
  Vision->>Vision: Quality metrics and provider route
  Vision-->>Edge: Structured result or partial/unavailable
  Edge->>DB: Create report + canonical ticket or link duplicate + audit event
  Edge-->>Web: Ticket reference + AI state + duplicate hint
  Web-->>Resident: Confirmation; report remains saved if AI failed
```

Implementation note: use a stable idempotency key per submission. A retry after timeout must not create a duplicate ticket. Write transactionally where possible. If Storage succeeds but DB persistence fails, run a compensating delete or leave a traceable orphan for cleanup.

## 5. Repair verification sequence

1. Staff/resident submits after-repair evidence against a known ticket.
2. Edge API validates role, ticket state, file type/size, and rate limit.
3. Image is stored as evidence; service receives time-limited access or streamed bytes.
4. Vision service compares evidence using a configured provider and validates the output.
5. A positive assessment is stored with `requires_staff_confirmation=true`.
6. Staff reviews before/after views and AI evidence, then confirms, rejects, or requests more evidence.
7. The transaction changes ticket state and appends `resolution_verified` or `status_changed` event. AI inference itself cannot close the ticket.

## 6. AI provider routing algorithm

1. Resolve allowed providers for the requested task and data-sensitivity policy.
2. Run deterministic image-quality validation first for image tasks.
3. Choose the highest-priority enabled provider that supports the task and required modality.
4. Apply a strict connect/read timeout and at most one bounded retry for transient network/5xx errors. Do not retry a 4xx invalid request.
5. Validate JSON/required fields; normalize numbers, enums, lengths, boxes and confidence.
6. If the provider fails, try a configured allowed fallback. Do not send sensitive data to a provider unless policy explicitly permits it.
7. If all providers fail or no key is configured:
   - image analysis: return local quality findings as `partial`; no detection claim;
   - chat: answer a grounded static FAQ when the question matches, otherwise say generative chat is unavailable;
   - repair comparison: return `unavailable`, require manual review.
8. Health reports `configured`, `last_success_at`, `last_error_code`, and task capabilities separately. A deployment key being present is not proof the remote API is working.

## 7. State transitions

Proposed target state machine (migrate from the current enum only via a reviewed migration):
- `Pending -> Assigned`
- `Pending -> Rejected` only by staff/admin with reason
- `Assigned -> In Progress`
- `In Progress -> Resolved Pending Review`
- `Resolved Pending Review -> Resolved` after staff confirmation
- `Resolved Pending Review -> In Progress` when verification is declined
- `Resolved -> Reopened` by authorized staff or through a documented resident appeal flow
- `Any non-terminal state -> Duplicate` only when linked to a canonical ticket and event is appended

Until the state migration is accepted, the current deployed states (`Pending`, `Assigned`, `In Progress`, `Resolved`) must remain interoperable. Do not send an enum value the current database rejects.

## 8. Security and validation rules

- Validate a Supabase JWT for every protected route; derive user ID from the verified token, never from request JSON.
- Staff/admin permissions are checked server-side against trusted profile/role data.
- Enforce image maximum bytes, pixels, content type plus file-signature checks, image decoding, safe resize and EXIF stripping.
- Never log base64/photo bytes or full authorization headers.
- Use provider keys only as server environment variables. Use distinct `AI_SERVICE_TOKEN` and provider keys; rotate secrets if exposed.
- Strictly validate AI outputs; prompt injection in user descriptions is untrusted input and cannot change system policy.
- Sanitize public issue data and media links. Keep original evidence private where possible and issue short-lived signed URLs to authorized viewers.
- Rate-limit report creation, AI calls and chat separately. Add CAPTCHA/abuse controls before public scale.
- Use safe public error messages and store detailed but sanitized diagnostics in logs.

## 9. Test plan

- Unit: validators, photo-quality metrics, category normalization, score boundaries, output parsing, provider routing, state transition rules.
- Contract: Gemini image and text payload formatting; OpenRouter chat completion with text + images; response normalization for expected success and malformed JSON.
- Failure: key missing, 401/403, quota 429, provider 5xx, timeout, invalid image, oversized pixel dimensions, unexpected model output, no model listed.
- API: unauthenticated staff update denied; resident cannot assign/close; vote is one-per-user; comment ownership; idempotent report retries; duplicate race.
- Data: migrations on clean database and current snapshot; foreign keys; RLS policy checks; spatial index usage.
- E2E: sign in, submit report, verify storage and list visibility, submit duplicate nearby report, comment, vote, assign, status update, submit repair evidence, staff confirm, audit timeline.
- Release gate: all tests pass, no provider secret in bundle/logs, deployed AI health is real, frontend smoke test passes, and rollback flag tested.
