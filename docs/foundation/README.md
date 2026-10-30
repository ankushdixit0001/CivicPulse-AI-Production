# Foundation implementation

Branch: `feat/foundation-phase-5`

## Scope
This change establishes the security and contract foundation before advanced AI work:
- additive migration for role/row access hardening and atomic staff resolution audit;
- explicit API contracts and input validators;
- reusable Supabase Auth REST/session module with refresh/sign-out primitives;
- automated Node test suite for auth/session and input validation;
- environment variable contract and local Supabase configuration guidance.

## Required environment
Frontend:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_API_BASE_URL` (optional; defaults to the Supabase Edge Function URL)

Edge Function secrets:
- `SUPABASE_URL` (platform-provided)
- `SUPABASE_SERVICE_ROLE_KEY` (server-side only)
- `CIVICPULSE_ALLOWED_ORIGINS` (comma-separated allowlist)
- AI secrets are intentionally not part of this foundation gate.

Never prefix service-role or secret keys with `VITE_`.

## Migration discipline
The live project has a migration history entry not present in the checked-in migration directory and existing migration timestamps differ. Do not apply the new migration to production until the history is reconciled in a dedicated change and a disposable Supabase project successfully runs `supabase db reset`.

## Tests
Run:
```sh
cd frontend-app
npm ci
npm test
npm run build
```
SQL policy verification is in `supabase/tests/foundation_rls.test.sql` and should run against the local Supabase database after reset.
