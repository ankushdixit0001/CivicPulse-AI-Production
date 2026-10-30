# 06 — Phase 0–4 Scope, Decisions and Acceptance

**Assessment baseline:** 2026-10-30  
**Scope is planning/design only.** This phase package does not implement application features or mutate production infrastructure.

Because a separate CivicPulse “master specification” was not found, the phase names below define the execution contract for this planning engagement. They are not claimed to be verbatim headings from a missing master document.

## Phase 0 — Workspace discovery and baseline

**Goal:** identify the correct repository, environments, live services and authoritative artifacts.

**Completed**
- Inspected both GitHub repositories and selected CivicPulse-AI-Production as current baseline.
- Inspected source, legacy API, vision service, configuration, migrations, brief and deployment docs.
- Read connected Supabase project, schema, policies, indexes, selected function definitions, Storage, migration history, Edge Function status and Security/Performance advisors.
- Inspected Vercel project, environment metadata, latest production deployment and deployment history.
- Searched Canva and connected Library for a named CivicPulse master specification/design; no matching master document was found.

**Exit criteria**
- [x] Production repo and branch identified.
- [x] Supabase and Vercel environments identified.
- [x] Legacy vs production APIs distinguished.
- [x] Specification gaps and source conflicts recorded.

## Phase 1 — Full project audit and requirements baseline

**Goal:** consolidate current capability, gaps, security, reliability, operations and product scope.

**Completed**
- Feature inventory and implementation status.
- Data model and RLS policy inventory.
- Critical audit-event constraint mismatch identified.
- Public photo access/privacy mismatch identified.
- Auth security advisor warning recorded.
- AI provider and deployment uncertainty recorded.
- Migration history drift, duplicate concurrency and vote-counter concerns documented.
- CI/CD and release traceability gaps documented.

**Exit criteria**
- [x] Current features classified as implemented/partial/unverified/not present.
- [x] P0/P1/P2 risk register documented.
- [x] Product decisions/owner questions surfaced.
- [x] Audit evidence and verification limitations stated.

## Phase 2 — Technology and external API feasibility

**Goal:** review the provider APIs found in source, confirm official documentation and assess feasibility/availability.

**Completed**
- Supabase Auth, Postgres/PostGIS, Storage and Edge Functions docs reviewed.
- OpenAI gpt-4.1-mini image-input and pricing/model docs reviewed.
- LLMFaucet fallback identified as an undocumented/unverified community dependency.
- Nominatim and OSM tile policy limitations captured.
- GitHub and Vercel source/release role documented.
- Control-plane availability checked for Supabase Edge Function and Vercel deployment.
- Direct HTTP check limitations recorded.

**Exit criteria**
- [x] Official documentation links included.
- [x] API role, credential boundary and provider risks documented.
- [x] Availability verification results distinguish control-plane status from request-level checks.
- [x] Provider decisions and unresolved dependencies listed.

## Phase 3 — High-Level Design

**Goal:** establish service boundaries, trust boundaries, deployment topology and design quality attributes.

**Completed**
- Logical component architecture.
- Proposed target data/report and resolution sequences.
- Clear separation of React/Vercel, Supabase Edge, database/storage, FastAPI vision and provider.
- Legacy Express/Mongoose exclusion decision.
- NFR targets and architecture risk mitigations.

**Exit criteria**
- [x] One production source of truth selected.
- [x] Privileged service boundaries and secret locations documented.
- [x] Resilience when AI/geocoding providers fail described.
- [x] Human confirmation for resolution retained.

## Phase 4 — Low-Level Design and data/API design

**Goal:** define endpoint contracts, role matrix, workflow/state transitions, ERD, SQL schema and tests.

**Completed**
- API route inventory and request/response contracts.
- Role permission matrix.
- Ticket lifecycle and transactional audit requirements.
- AI response schema, validation and fallback status.
- Current ERD and proposed normalized vNext entities.
- SQL reference DDL, RLS pattern and recommended hardening patches.
- Unit, DB, API integration, E2E and release test plan.

**Exit criteria**
- [x] Main data entities and relationships specified.
- [x] Endpoint/auth requirements documented.
- [x] Database constraints/indexes/RLS and known defect patches documented.
- [x] Migration safety note and no-live-change boundary explicit.

## Phase 0–4 decisions made

| ID | Decision | Reason |
|---|---|---|
| D-01 | Use CivicPulse-AI-Production main as primary repo | Current Edge Function/migrations/production setup |
| D-02 | Supabase is system of record | Current production frontend writes through Supabase |
| D-03 | Keep Express/Mongoose out of production | Legacy duplicate backend would create split-brain writes |
| D-04 | React/Vite on Vercel remains web host | Existing deployment |
| D-05 | FastAPI is separately hosted | Image processing stack is heavier than static frontend host |
| D-06 | OpenAI API is preferred key-backed vision option | Official vision support and existing service code |
| D-07 | LLMFaucet is experimental, not production-approved | Provider availability/privacy/terms not verified |
| D-08 | Keep AI triage advisory and require staff confirmation | Public infrastructure and repair decisions need human review |
| D-09 | Move toward private-by-default evidence | Current photos may contain personal information |
| D-10 | Docs-only change during this engagement | Explicit instruction not to implement application features |

## Release blockers before application implementation can begin safely

1. Obtain and approve the actual master specification or confirm the repo documents are the complete requirements baseline.
2. Fix migration history drift: live index_foreign_keys entry is absent from tracked migrations; reconcile IDs and generate an accurate baseline.
3. Decide public vs private evidence and the location precision/retention/privacy notice.
4. Fix resolution event type mismatch and ensure status+event are atomic.
5. Approve production vision provider and verify Render/container, OpenAI billing/key and Edge secrets.
6. Approve CAPTCHA, forwarded-IP trust model and abuse/monitoring requirements.
7. Confirm municipality/department/ward taxonomy and actual assignment owner model.
8. Agree pilot volumes, p95 targets, budget and operational/support owner.

## Next phase proposal (not executed)

**Phase 5 — Controlled implementation planning** should begin only after owner approvals above. Suggested order: migration reconciliation and test project; security correctness fixes; API response/pagination/idempotency contracts; Storage privacy and image access; authenticated vision deployment/provider configuration; frontend auth/session and staff workflow polish; RLS/API/E2E tests; observability and pilot runbook. Each change should be a reviewed branch/PR and deployed to a non-production Supabase branch/project first.

## Explicit non-deliverables

- No app component, API route, AI feature, database table, policy, SQL function, index, trigger or enum was added to the live project.
- No existing application source was edited.
- No OpenAI/LLMFaucet/OSM/Render key was created or configured.
- No AI vision container was deployed.
- No Vercel deployment was triggered.
- No production report, user, issue or image data was created/modified/deleted.
- No Canva design was created or edited.
