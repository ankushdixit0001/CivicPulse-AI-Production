# CivicPulse AI — Phase 0–4 Architecture Package

**Repository:** [CivicPulse-AI-Production](https://github.com/ankushdixit0001/CivicPulse-AI-Production)  
**Branch:** `main`  
**Assessment date:** 2026-10-30  
**Status:** Planning and design only. No application feature implementation or production infrastructure change is included in this package.

## Deliverables

| Document | Purpose |
|---|---|
| [00 — Project audit](./00-project-audit.md) | Workspace, GitHub, Supabase and Vercel audit; implementation status; defects, drift and risk register |
| [01 — High-level design](./01-hld.md) | Target architecture, service boundaries, deployment topology and key quality attributes |
| [02 — Low-level design](./02-lld.md) | API contracts, workflows, role matrix, state transitions, validation and test strategy |
| [03 — Database ERD](./03-erd.md) | Current-state ERD, entity descriptions and recommended extension model |
| [04 — Database SQL design](./04-database-sql-design.sql) | Reference DDL for a fresh schema plus non-applied hardening patches |
| [04a — Transactional RPC design](./04a-database-rpc-design.sql) | Report deduplication, rate limits, vote counters and atomic resolution/event routines |
| [05 — External API research](./05-external-api-research.md) | Official API documentation, provider fit, availability checks, constraints and recommendations |
| [06 — Phase 0–4 scope and acceptance](./06-phase0-4-scope.md) | Phase boundaries, assumptions, decisions, open questions and exit criteria |

## Source-of-truth decision

A standalone file titled **“CivicPulse AI master specification”** was not present in the selected repository or located in the connected design search. The available sources were therefore ranked as follows:

1. Live production Supabase schema, policies, Edge Function deployment metadata and Vercel deployment metadata for observed state.
2. `DEPLOYMENT.md` and `README.md` in this repository for intended production architecture.
3. `CIVICPULSE_CLAUDE_BRIEF.md` as historical hackathon scope and limitations.
4. Tracked SQL migrations and application source for implementation detail.

Where these sources disagree, the audit records the conflict. No missing requirement is presented as a confirmed master-spec requirement.

## Phase boundary

This package completes discovery, audit, requirements consolidation, feasibility/API research, HLD, LLD, ERD and SQL design. It does **not** implement application features, edit frontend/backend/Edge Function source, alter Supabase schema/data/policies/secrets, configure API credentials, deploy the AI container, or trigger a Vercel deployment.

## Recommended reading order

Start with the audit, then HLD/LLD, then ERD/SQL, and finish with API research and the phase acceptance list. SQL in this package is a design reference; it is not an instruction to run it against the live database without a reviewed migration plan.

## Important current blockers

- The Edge Function writes a `resolved` event, but the live `issue_events_event_type_check` constraint does not allow that event type. The helper swallows the insert error, so the final resolution event can be missing.
- The public image bucket makes any image URL accessible to anyone who has it. The documentation is inconsistent about whether this bucket should be private.
- Supabase's security advisor reports leaked-password protection disabled.
- The vision container is not confirmed deployed/configured; the Edge Function can fall back to a community inference gateway that has no verified SLA or privacy contract in the reviewed sources.
- A Supabase migration recorded in the live project (`index_foreign_keys`) is not present in the selected repository tree. Reconcile migration history before schema work.
