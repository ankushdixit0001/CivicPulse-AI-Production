# CivicPulse AI

CivicPulse turns resident-submitted civic issue photos and locations into AI-assisted, prioritized tickets for a municipal operations team.

## Services
- **Production frontend:** React 18 + Vite + Tailwind on Vercel, source in `frontend-app/`
- **Production civic API:** Supabase Edge Function, source in `supabase/functions/civicpulse-api/`
- **Production data/auth:** Supabase Postgres/PostGIS, Auth and Storage, with migration sources in `supabase/migrations/`
- **AI orchestration service:** Python FastAPI + OpenCV/Pillow and capability-aware provider routing, source in `ai-vision-service/`
- **Legacy API:** Node.js + Express + Socket.IO + Mongoose in `backend-service/`; retained for reference/local legacy development, not the production source of truth.

> Production writes are handled by Supabase. The legacy Express/MongoDB API and Supabase are not parallel production data stores. The Python vision service is a separate container service and requires a deployed URL plus a private shared service token before the Edge Function can call it. See [Deployment](./DEPLOYMENT.md).

## Local development

### Production-shaped frontend/API
1. Install the frontend dependencies: `npm --prefix frontend-app ci`.
2. Create `frontend-app/.env.local` with `VITE_SUPABASE_PUBLISHABLE_KEY` set to the project's browser-safe publishable key. Keep service-role and AI keys out of all frontend variables.
3. Start the frontend with `npm --prefix frontend-app run dev`. In production mode it calls the configured Supabase Edge Function; for local tests, set `VITE_API_BASE_URL` only to a compatible local CivicPulse API.
4. Run the Python service if you want to test the AI boundary: `cd ai-vision-service`, install `requirements.txt`, copy `.env.example` to a local environment file, set a private `VISION_API_TOKEN`, then run `uvicorn app.main:app --reload --host 0.0.0.0 --port 5000`.

### Legacy Node API
The root `.env.example`, MongoDB setup and `npm run dev:backend` are for legacy/local Node API work only. They do not configure the deployed Supabase production API. Do not point the live frontend at MongoDB without a deliberate migration and integration test plan.

## Current reliability improvements on this branch
- Ticket listing no longer fabricates demo incidents when the database is empty or unavailable.
- Reports validate category, description, image type/size, and actual coordinates; no default New York location is silently used.
- Civic category labels are normalized before being stored, reducing general YOLO class/schema mismatches.
- New reports persist their description in the ticket document.
- Ticket resolution is blocked until a genuine before/after evidence workflow exists; the previous empty-image verification shortcut was removed.
- Production API startup fails if the persistent MongoDB connection is unavailable instead of silently accepting requests against ephemeral memory storage.
- API request-size and CORS handling are stricter.
- Vercel SPA rewrite configuration is included for direct routes like `/report` and `/command-center`.

## Architecture and design

See [the architecture package](./docs/architecture/README.md) for HLD, LLD, database design, API/provider matrix, proposed additive schema and implementation acceptance gates. The proposed SQL is documentation only and has not been applied to production.

## Deployment
See [DEPLOYMENT.md](./DEPLOYMENT.md) for the frontend/API/vision split, environment variables, and production checklist. The frontend should be deployed to Vercel with Root Directory `frontend-app`; the Express API and Python vision service need persistent service/container hosting.

## Known limitations
- The live app uses Supabase, but the separate FastAPI vision container still needs to be deployed and configured with a matching private service token.
- Keyless community inference is best-effort and shared. Chat, vision analysis and repair comparison can fail independently; each capability must be tested live before it is marked available.
- OpenCV/Pillow can validate photo quality but cannot identify civic defects. Generic YOLOv8n/COCO is not a validated civic-defect classifier.
- AI priority scores and repair comparisons are estimates. Authorized municipal staff retain final responsibility for status and resolution.
- The current evidence bucket is documented as public. Keep only intentionally public civic evidence there and review visibility/privacy before broader rollout.
- Some dashboards/map controls remain prototypes; real-time Socket.IO subscriptions are not implemented in the production frontend.
- Full staging/production smoke tests, provider probes, notification workers and optional extension tables are in the architecture roadmap.

Never commit API keys, database passwords, Supabase service-role keys, or production environment files.
