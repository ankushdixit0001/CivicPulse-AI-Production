# CivicPulse AI

CivicPulse turns resident-submitted civic issue photos and locations into AI-assisted, prioritized tickets for a municipal operations team.

## Services
- **Frontend:** React 18 + Vite + Tailwind, in `frontend-app/`
- **API:** Node.js + Express + Socket.IO + Mongoose, in `backend-service/`
- **Vision:** Python FastAPI + OpenCV + Ultralytics YOLO, in `ai-vision-service/`
- **Database foundation:** Supabase/Postgres schema with PostGIS, Auth-linked profiles, issue tickets, events, comments, votes and RLS policies in `supabase/`

> The existing Node API still uses MongoDB/Mongoose. The Supabase schema is a separate foundation and is not wired into the API yet. Do not assume data is being written to both systems.

## Local development
1. Copy `.env.example` to `.env` and configure the services.
2. Install Node dependencies with `npm install` at the root.
3. Start MongoDB (or use the non-production in-memory development fallback).
4. Start the API with `npm run dev:backend`.
5. Start the frontend with `npm run dev:frontend`.
6. Start the vision service from `ai-vision-service/` using `uvicorn app.main:app --reload --host 0.0.0.0 --port 5000`.

## Current reliability improvements on this branch
- Ticket listing no longer fabricates demo incidents when the database is empty or unavailable.
- Reports validate category, description, image type/size, and actual coordinates; no default New York location is silently used.
- Civic category labels are normalized before being stored, reducing general YOLO class/schema mismatches.
- New reports persist their description in the ticket document.
- Ticket resolution is blocked until a genuine before/after evidence workflow exists; the previous empty-image verification shortcut was removed.
- Production API startup fails if the persistent MongoDB connection is unavailable instead of silently accepting requests against ephemeral memory storage.
- API request-size and CORS handling are stricter.
- Vercel SPA rewrite configuration is included for direct routes like `/report` and `/command-center`.

## Deployment
See [DEPLOYMENT.md](./DEPLOYMENT.md) for the frontend/API/vision split, environment variables, and production checklist. The frontend should be deployed to Vercel with Root Directory `frontend-app`; the Express API and Python vision service need persistent service/container hosting.

## Known limitations
- YOLOv8n is a general object detector, not a validated civic-defect model. Its output should be treated as an assistive estimate.
- The API still needs real authentication and staff authorization before handling public reports.
- The command-center map and some dashboard controls remain prototypes; live Socket.IO subscription is not implemented.
- Images are not yet stored in durable private object storage.
- Supabase is not yet the live API persistence layer.
- Before/after image verification and review remain roadmap work.

Never commit API keys, database passwords, Supabase service-role keys, or production environment files.

## Architecture rebuild (in progress)

The target production architecture keeps Supabase/Postgres/PostGIS as the single data source, the Supabase Edge Function as the public API/policy boundary, and the original FastAPI service as the single AI orchestration layer. The old Express/Mongoose API remains legacy and is not a production write path.

Read the design before extending features:
- [High-Level Design (HLD)](./docs/architecture/HLD.md)
- [Low-Level Design (LLD) and API contracts](./docs/architecture/LLD.md)
- [Database design and migration sequence](./docs/architecture/DATABASE_DESIGN.md)
- [AI provider evaluation and privacy policy](./docs/architecture/AI_PROVIDER_MATRIX.md)
- [Feature catalogue, priorities and release gates](./docs/architecture/FEATURE_CATALOGUE_AND_PLAN.md)

The AI service now has a provider-adapter module for Gemini, OpenRouter, and the existing OpenAI-compatible API. External text/image processing defaults to **disabled** unless policy flags are explicitly enabled. Without an allowed provider, the service must return honest partial/unavailable results; local image-quality checks can still run. The app must never use a shared public bearer string as if it were an application credential.

This is a staged rebuild. The architecture branch is not yet production-verified. Do not mark multimodal inference as working until the provider has been configured in the AI host, a non-personal test image has been analyzed successfully, repair comparison/chat have been exercised, and error/permission paths pass.
