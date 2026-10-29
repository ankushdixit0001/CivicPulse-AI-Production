# CivicPulse AI — Architecture Package

This directory contains the architecture baseline for the CivicPulse rebuild.

| Artifact | What it covers |
|---|---|
| [HLD](./HLD.md) | Target architecture, actors, feature scope, workflows, security, reliability and architecture decisions |
| [LLD](./LLD.md) | API contracts, modules, data flow, state machine, validation, provider routing and test plan |
| [Database design](./DATABASE_DESIGN.md) | Observed live schema, ERD, proposed additions, indexes, RLS and compatibility requirements |
| [API/provider matrix](./API_PROVIDER_MATRIX.md) | API candidates by task, no-key fallback caveats, optional keyed providers, health and routing rules |
| [Implementation roadmap](./IMPLEMENTATION_ROADMAP.md) | Phases, exit gates, deployment requirements and release checklist |
| [Proposed schema SQL](./PROPOSED_SCHEMA.sql) | Additive schema proposal only; **not applied** to the live database |

## How to read this package

1. HLD defines the target shape and boundaries.
2. LLD defines how modules and endpoints should behave.
3. Database design distinguishes the live schema from future tables.
4. Provider matrix defines capability-by-capability API selection.
5. Roadmap defines acceptance gates before anything can be declared complete.

## Architecture baseline observed

- Production frontend: Vercel + React/Vite.
- Production civic data/auth: Supabase Auth, Postgres/PostGIS, Storage and Edge Function.
- Intended internal AI service: FastAPI under ai-vision-service; its source is present but external deployment is still required.
- Legacy Node/Mongoose backend: not the production source of truth.
- Existing community AI gateway: best-effort only; its vision/repair capability and real-time availability must be tested separately.

## Safety of changes

This set of design documents was added on the rebuild/architecture-foundation branch. Production database migrations, service secrets, provider keys and deployments are not changed by these documents. PROPOSED_SCHEMA.sql must not be applied before adding and testing RLS policies and staging migrations.
