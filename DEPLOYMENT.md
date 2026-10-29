# CivicPulse AI deployment

## Current state
This repository is a three-service monorepo:
- `frontend-app`: React/Vite single-page app; deploy this folder as a Vercel project.
- `backend-service`: Express + Socket.IO API; deploy as a persistent Node service (not a Vercel static frontend).
- `ai-vision-service`: FastAPI + YOLO/PyTorch; deploy as a separate Python container/service. It is not a good fit for a static Vercel build.

The Supabase schema in `supabase/migrations` is a new database foundation for a Supabase-backed iteration. The existing Node API still uses Mongoose/MongoDB; it is **not yet migrated to Supabase**. Do not configure production to expect the Supabase tables until the API integration is implemented and tested.

## Vercel frontend
1. Import the new GitHub repository into Vercel (the original fork is not modified by this branch).
2. Set **Root Directory** to `frontend-app`.
3. Framework preset: Vite. Build command: `npm run build`. Output directory: `dist`.
4. Add `VITE_API_BASE_URL` with the public HTTPS URL of the deployed Express API, for both Preview and Production.
5. The `frontend-app/vercel.json` file supplies the SPA rewrite so direct navigation to `/report` and `/command-center` loads the app.
6. Redeploy after environment variable changes.

## Node API service
Set:
- `NODE_ENV=production`
- `PORT` to the platform-provided port (the server already reads it)
- `MONGODB_URI` to a managed MongoDB connection string
- `AI_SERVICE_URL` to the deployed FastAPI base URL
- `CORS_ORIGIN` to the exact Vercel production domain(s), comma-separated
- `GEMINI_API_KEY` only if the chatbot should use Gemini

Never commit credentials. Do not rely on the in-memory MongoDB fallback for production: it is ephemeral and unsuitable for persistent reports.

## AI service
Deploy `ai-vision-service/Dockerfile` to a Python/container host with enough memory for PyTorch/Ultralytics and the model file. Configure `AI_SERVICE_URL` on the API. The current YOLO model is a general object detector, not a validated civic-damage classifier; present its scores as assistive estimates, not ground truth.

## Database
The dedicated Supabase project is `ccrhdrjywnaccthzyjte` in Mumbai (`ap-south-1`). Its migration creates profiles, civic issues, issue events, comments, and votes with RLS. The current API has not yet been migrated from MongoDB to Supabase; do not mix the two persistence paths until an explicit migration is implemented.

## Before calling this production-ready
- Add real authentication and enforce staff roles server-side.
- Store report photos in a private object store/Supabase Storage and enforce upload access.
- Add rate limiting, content validation, malware/image validation, request timeouts, and audit logs.
- Wire actual map markers and Socket.IO client subscriptions.
- Implement a real before/after resolution workflow; never mark issues resolved from empty placeholder images.
- Add automated API, RLS, and frontend tests; run them before promoting a production deployment.
