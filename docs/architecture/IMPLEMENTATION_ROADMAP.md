# CivicPulse AI — Implementation Roadmap and Acceptance Gates

**Purpose:** Rebuild safely from documented architecture while keeping the live application usable. Adding this plan does not change the production database/services.

## Phase 0 — Architecture baseline (this branch)

Deliverables: HLD, LLD, database design, provider matrix and proposed additive schema. Separate current behavior, proposed capabilities and legacy code.

Exit gate: core-release scope and deferred features are explicitly accepted.

## Phase 1 — Test baseline and security audit

- Add CI to install/build the frontend and run unit/contract tests.
- Add FastAPI tests for health, service-token validation, image validation, no-key behavior and invalid provider responses.
- Maintain one environment template per service; scan for secrets.
- Review CORS, Storage visibility, RLS, role elevation and service-role code paths.
- Fix AI health semantics so configured, probed, available and capability are distinct.
- Add correlation IDs and safe provider-failure logging.

Exit gate: build passes; no private key in frontend; tests prove staff-only actions, manual repair confirmation and report submission while AI is down.

## Phase 2 — AI service modularization

- Keep Python FastAPI as the internal AI orchestration service.
- Add provider adapters and a task-capability registry.
- Preserve local photo-quality checks as deterministic fallback.
- Add separate health status for chat, vision analysis and repair verification.
- Normalize output to a versioned schema; validate/clamp all model output.
- Store safe provider/status/latency metadata only.
- Make Edge Function AI failures return an explicit partial/unavailable state.

Exit gate: mocked tests cover success, timeout, rate limit, 5xx, unsupported image, malformed JSON and invalid bounding boxes. Any provider marked enabled must pass a real test for that capability. No model can automatically resolve an issue.

## Phase 3 — Civic API and transactional integrity

- Centralize route schemas, pagination, error envelope and role checks.
- Add idempotency for report creation.
- Make duplicate merge atomic via Postgres RPC/transaction and PostGIS query.
- Maintain vote counts safely and enforce the unique vote key.
- Ensure issue update plus issue_event insert is atomic.
- Restrict event metadata and returned fields by audience.
- Audit public storage and direct PostgREST paths.

Exit gate: concurrency test proves parallel duplicate reports merge correctly; retries do not duplicate issues; residents cannot elevate roles or alter status/priority/resolution; writes have consistent audit events.

## Phase 4 — Frontend integration

- Central CivicPulse API client for auth, multipart/JSON, timeout, request IDs and typed errors.
- Keep existing report/command-center routes while refactoring components.
- Show separate AI capability states and explicit degraded mode.
- Improve accessibility, mobile report flow, camera/gallery and retry/error states.
- Avoid false success states and direct third-party AI requests from the browser.

Exit gate: desktop/mobile smoke tests complete; UI response types match backend contracts; reporting continues when AI is down.

## Phase 5 — Additive features when product scope requires them

Potential tables: issue_media, ai_analysis_runs, issue_assignments, notification_outbox, notifications, notification_preferences, jurisdictions, staff coverage, SLA policies, moderation flags and saved searches.

Each table must include a versioned migration, RLS policies, grants, indexes, rollback/forward-fix note and tests. Do not create unused schema because it appears in this design.

Exit gate: migration runs on staging, Supabase security advisors are reviewed and query plans are checked before production migration.

## Phase 6 — Operations and product extensions

- In-app/email notifications and preferences.
- Ward/zone assignment, SLA warning/escalation.
- Admin analytics and exports.
- Multilingual help assistant and accessible PWA/offline drafts.
- External municipal integrations only with a real interface contract.

Exit gate: retry/idempotency, permissions, retention and consent are tested per feature.

## Phase 7 — Deployment and acceptance

Before calling a release complete:

1. Main branch build and tests pass.
2. Deploy FastAPI to a verified container host with VISION_API_TOKEN configured; never commit it.
3. Configure the matching AI service URL/token through server-side secrets.
4. Test real health, analysis, chat and repair-verification calls separately.
5. Submit a report with AI healthy and with AI unavailable.
6. Test duplicate merge, voting, comments, staff status transition, repair photo, explicit staff confirmation and event timeline.
7. Review Supabase security/performance advisors and service logs.
8. Verify deployed Vercel URL, deployment commit and client network requests.
9. Record commit SHA, deployment ID, test results, known limits and rollback path.

Do not claim an API or end-to-end flow works until its corresponding live test passes.

## Release checklist

- [ ] HLD/LLD/database design reviewed.
- [ ] Each active AI capability has passed a capability-specific test.
- [ ] Migration dry run and rollback/forward-fix prepared.
- [ ] RLS, Storage visibility and role escalation checked.
- [ ] Unit, integration and concurrency tests pass.
- [ ] Frontend build and mobile report flow pass.
- [ ] Reports persist when AI is unavailable.
- [ ] No false AI-health or repair-verification claim.
- [ ] Production smoke test and deployment evidence recorded.
