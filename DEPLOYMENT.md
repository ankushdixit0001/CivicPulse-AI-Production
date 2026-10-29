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

## AI vision service (remaining external deployment)

The FastAPI/YOLO service is a Docker workload and should run separately from the static Vercel frontend. A Render Blueprint is included at `render.yaml`; import this repository into Render and deploy the `civicpulse-ai-vision` service. Check `/health` after deployment.

Then configure the Supabase Edge Function secret with the deployed service base URL:

```bash
supabase secrets set AI_SERVICE_URL=https://YOUR-AI-SERVICE.onrender.com --project-ref ccrhdrjywnaccthzyjte
```

Use the real HTTPS URL supplied by your hosting provider. Do not include `/analyze` at the end. Once configured, the API calls `/analyze` for new reports and `/verify-resolution` for after-repair evidence. Until then, reports are still saved, but the API explicitly marks AI analysis as unavailable and will not auto-resolve issues.

The current YOLO model is a general object detector, not a validated civic-damage classifier. Treat scores as assistive estimates, not ground truth.

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
- [ ] Add rate limiting / abuse controls before broad public launch; public report intake is intentionally open.
