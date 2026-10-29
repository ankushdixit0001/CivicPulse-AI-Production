# CivicPulse AI deployment

## Live services

- **Frontend:** https://civicpulse-ai-production.vercel.app
- **Supabase project:** `ccrhdrjywnaccthzyjte` (Mumbai, `ap-south-1`)
- **Supabase API function:** `https://ccrhdrjywnaccthzyjte.supabase.co/functions/v1/civicpulse-api`
- **Vision service:** source and Dockerfile are in `ai-vision-service`; it still needs to be deployed to a container host and configured below.

The deployed frontend uses the Supabase Edge Function for report submission, issue listing, account sign-in, voting, comments, staff status changes, audit history, and repair-evidence submission. The old `backend-service` Express/Mongoose implementation remains in the repository for local/legacy use; it is **not the production data source**. Do not treat MongoDB and Supabase as parallel sources of truth.

## Frontend (Vercel)

The production deployment uses `frontend-app` as its root directory with Vite, `npm run build`, and output directory `dist`.

Vercel project environment variable:
- `VITE_SUPABASE_PUBLISHABLE_KEY` — Supabase publishable key; it is intended for browser use and is not a service-role secret.

The frontend defaults to the deployed Supabase Edge Function URL. Optional `VITE_API_BASE_URL` overrides that URL for a different environment. Redeploy after changing Vite environment variables.

## Supabase database and API

The migrations in `supabase/migrations` create the profiles, civic issues, issue events, comments, and votes schema, the PostGIS duplicate-report RPC, and the `civic-issue-images` Storage bucket. The API Edge Function is tracked at `supabase/functions/civicpulse-api/index.ts`.

AI capabilities in `ai-vision-service`:
- Image integrity/size/dimension checks and photo-quality analysis (blur, brightness, contrast, resolution).
- OpenAI vision classification against the citizen-selected category, with conservative confidence, visible evidence, suggested action, bounding boxes, and human-review flags.
- Generic YOLO object context is supplemental only; it is not treated as a civic-defect classifier and never fabricates a detection when no object is found.
- Before/after repair comparison with confidence and evidence output. It cannot close a ticket by itself; a staff/admin account must explicitly confirm the AI-assisted result.
- A live AI health endpoint is shown in the Command Center.
- If the OpenAI key or service is unavailable, reports are still saved, but the result is clearly marked partial/unavailable and the app does not pretend a defect was detected.

Implemented API flows:
- Public issue intake with image upload, validation, AI triage when configured, and 15-metre same-category duplicate merging.
- Issue list with filters and a database-backed dispatch board.
- Supabase Auth email/password signup and sign-in.
- Authenticated per-account votes and comments.
- Staff/admin-only status changes and audit events.
- After-repair image upload; the issue is marked Resolved only when the configured vision service returns a successful positive verification. If AI is unavailable, evidence is saved and the issue stays open.

The API function uses Supabase's server-side `SUPABASE_SERVICE_ROLE_KEY` runtime secret. Never copy that key into the frontend, a `VITE_*` variable, or GitHub. The Edge Function is configured with JWT gateway verification disabled because public reports are allowed; the function itself validates Supabase user tokens for protected actions and checks `profiles.role` for staff/admin operations.

### Promote an account to staff/admin

1. Create an account from the Command Center sign-in panel.
2. In Supabase SQL Editor, run the following with the email of the account you intend to promote:

```sql
update public.profiles p
set role = 'admin'
from auth.users u
where p.id = u.id
  and u.email = 'YOUR_ADMIN_EMAIL';
```

Use `staff` instead of `admin` for staff access. Replace the placeholder email before running it. Do not promote an account you do not control.

### Image privacy

The `civic-issue-images` bucket is public because report and repair evidence is intended to be visible with public civic tickets. Do not upload identity documents, private images, or unrelated personal data to this bucket.

## AI vision service and provider configuration

The original FastAPI service in `ai-vision-service` is the only approved place for model-vendor calls. Supabase Edge Function routes to it using a private service-to-service token. Do not call model vendors directly from the browser or from the Edge Function.

### Deploy the service

1. Import this repository into Render and deploy the `civicpulse-ai-vision` Blueprint.
2. The Blueprint requires `VISION_API_TOKEN`. Generate a long random secret and configure it in Render. Use the exact same value for Supabase's `AI_SERVICE_TOKEN`; do not commit it.
3. Check `/health/live` for process liveness. `/health` reports provider configuration and recent successful task calls; a process being alive is not proof that inference works.
4. Set Supabase Edge Function secrets to the real HTTPS service base URL and matching private token:

```bash
supabase secrets set AI_SERVICE_URL=https://YOUR-AI-SERVICE.onrender.com AI_SERVICE_TOKEN=YOUR_SAME_RANDOM_VISION_TOKEN --project-ref ccrhdrjywnaccthzyjte
```

Replace placeholders with the actual URL and secret. Do not include `/analyze` at the end of `AI_SERVICE_URL`. Do not paste the token into Vercel `VITE_*` variables.

**Render free services are for demos/testing, not production uptime guarantees.** They may cold-start or be resource constrained. A dependable public launch needs an appropriate hosting plan and a monitoring/rollback plan.

### Choose an AI provider

The service works without an external model key, but in that mode its image-analysis result is deliberately partial: local image-quality checks may run, but the app must not claim a civic defect was detected. Repair verification is unavailable and staff must manually inspect evidence.

For a free-tier prototype, the first option is a Google Gemini API key:
- Create a key in [Google AI Studio](https://aistudio.google.com/app/apikey).
- Set `GEMINI_API_KEY` in the **Render service's secret environment**.
- `GEMINI_MODEL` defaults in the Blueprint to `gemini-3.8-flash`; check the current [model list](https://ai.google.dev/gemini-api/docs/models) and [pricing/data-use policy](https://ai.google.dev/gemini-api/docs/pricing) before use.

An optional multimodal fallback is OpenRouter:
- Create `OPENROUTER_API_KEY` and store it only in Render.
- The starting vision model is `nvidia/nemotron-3.5-super-vl:free`; see its [current capabilities, limits and data warning](https://openrouter.ai/nvidia/nemotron-3.5-super-vl:free).
- Free hosted inference is rate-limited and has no guaranteed SLA. The model page warns against sending confidential/personal information. Keep OpenRouter image fallback disabled unless the app's privacy policy and consent explicitly allow it.

The existing OpenAI-compatible adapter remains optional (`OPENAI_API_KEY` and `OPENAI_VISION_MODEL`). No provider key is included in the frontend.

### Privacy switches

The Blueprint intentionally defaults to:
- `ALLOW_EXTERNAL_IMAGE_AI=false`
- `ALLOW_EXTERNAL_TEXT_AI=false`
- `ALLOW_OPENROUTER_IMAGE_FALLBACK=false`
- `ALLOW_OPENROUTER_TEXT_FALLBACK=false`

External AI is disabled until you have reviewed the selected provider's data handling and the application's user notice. Once policy permits the relevant processing, set the appropriate flags in the Render dashboard. Gemini free-tier data-use terms may differ from paid-tier terms. Never route personal/confidential photos through a free shared inference route by default.

### AI health and behavior

- `GET /health/live` is only a process-liveness check.
- `GET /health` reports configured capabilities separately from a recent successful request.
- `GET /health/providers` requires `x-civicpulse-ai-token` and returns sanitized provider configuration/state.
- AI provider keys missing, rate-limited, timing out or returning invalid JSON must cause a clear partial/unavailable result; they must not block report persistence.
- Before calling a release complete, test a non-personal sample image, text chat, synthetic before/after repair pair, and missing-key/401/429/timeout/provider-failure paths. A successful frontend build is not an AI integration test.

See [HLD](./docs/architecture/HLD.md), [LLD](./docs/architecture/LLD.md), [database design](./docs/architecture/DATABASE_DESIGN.md), [AI provider matrix](./docs/architecture/AI_PROVIDER_MATRIX.md), and [feature/release plan](./docs/architecture/FEATURE_CATALOGUE_AND_PLAN.md) for the full design.

## Legacy Node API

`backend-service` still uses Mongoose/MongoDB and the old shared staff-token design. It is not connected to the live frontend deployment. If you continue using it for local development, configure its own environment separately; do not point production frontend traffic at it without a deliberate migration and test plan.

## Operational checklist

- [x] Supabase schema and RLS enabled; public reads and validated public intake are separated.
- [x] Supabase Storage bucket and spatial duplicate-report RPC created.
- [x] Supabase Edge Function deployed.
- [x] Frontend wired to the Edge Function, with polling, Auth UI, voting/comments, staff workflow, and repair-evidence upload.
- [x] Production frontend build completed successfully.
- [ ] Deploy the Python vision container and set the Edge Function `AI_SERVICE_URL` secret.
- [ ] Create/promote the actual admin account before staff workflow testing.
- [ ] Perform a real end-to-end smoke test with an uploaded image, a duplicate report, comments/vote, staff status changes, and verified after-repair evidence.
- [x] Database-backed report rate limit (5 reports/hour per account/IP) and image-signature validation.
- [ ] Add stronger anti-abuse controls (such as CAPTCHA and monitoring) before broad public launch; public report intake is intentionally open.


## AI vision regression tests

Run the image-processing and model-output safety tests from the repository root:

```bash
cd ai-vision-service
python -m pip install fastapi==0.111.1 pillow==10.4.0 opencv-python-headless==4.10.0.84 numpy==1.26.4 python-multipart==0.0.9 httpx==0.27.2
python -m unittest discover -s tests -v
```

The tests cover 0–1000 and 0–1 bounding boxes, invalid coordinates, non-finite confidence/priority values, image type/size/dimension validation, photo-quality flags, inference-token authentication, priority scoring, and repair-verification thresholds. The generic YOLO detector is optional for tests; the suite does not need model weights or an OpenAI key.

## Repair confirmation behavior

AI repair verification is advisory. A staff/admin member must inspect the after-repair photo and confirm the result. If AI verification is unavailable or inconclusive, the staff member can explicitly override it after a confirmation prompt; the action requires a review note and is written to the issue event history. The system never marks a ticket resolved solely because the AI returned a positive result.
