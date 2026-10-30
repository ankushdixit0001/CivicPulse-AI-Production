# CivicPulse AI — Architecture Decisions, Risks and Phase Gate
Date: 2026-10-30 · Draft decisions for owner approval

## Decisions
1. **Single source of truth:** Supabase PostgreSQL/PostGIS is production system of record. No MongoDB/Postgres dual writes.
2. **Legacy API:** Express/Mongoose remains isolated; no production frontend traffic until migration decision and authorization redesign.
3. **Modular monolith:** Core app uses clear modules in Edge Functions; no premature microservices.
4. **AI service:** Python FastAPI is a separate workload for image processing and model adapters.
5. **Async processing:** AI, notifications and analytics run from durable job/outbox records; intake persistence does not wait for providers.
6. **Provider abstraction:** Vision, language, embeddings, maps, geocoding, routing, email and push each have adapters and health/usage monitoring.
7. **Human resolution:** AI provides advisory repair comparison; authorized staff makes final resolution decision.
8. **Tenant-aware data:** Organization/city/ward/department scope exists in target schema from the start.
9. **Private original evidence:** Original photos private by default; public derivative is a separate asset and policy.
10. **Duplicate candidates:** Spatial proximity alone does not merge issues; use multi-signal scoring and review.
11. **Map separation:** MapLibre renderer is separate from tile/geocoding/routing provider.
12. **API contracts:** Versioned DTOs and stable error envelope are mandatory.

## Risk register
| ID | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Public AI gateway changes/unavailable | High | High | Do not trust unverified gateway; adapter and transparent unavailable status |
| R2 | Vision misclassification | High | High | Labeled local benchmark, calibration, staff review |
| R3 | Free quotas exhausted | High | Medium/High | Quota monitor, bounded fallback, spend guard |
| R4 | Public photo exposure | Medium | High | Private originals, public derivative, signed URLs |
| R5 | Duplicate false positive | Medium | High | Multi-signal candidate, review, reversible links |
| R6 | Cross-tenant leak | Medium | Critical | Tenant RLS and adversarial tests |
| R7 | Legacy API accidentally used | Medium | High | Isolate env/secrets, remove frontend config after verified cutover |
| R8 | Edge CPU/time limits | Medium | High | Offload heavy inference and jobs |
| R9 | OSM public endpoint blocks production | Medium | High | Hosted provider or self-host |
| R10 | Provider data terms unsuitable | Medium | High | Privacy review, minimize submitted data |
| R11 | Jobs lost/duplicated | Medium | High | Transactional outbox and idempotency |
| R12 | No labeled civic dataset | High | High | Build consented, representative labeled dataset |
| R13 | Priority/SLA inaccurate | Medium | High | Municipal policy ownership and calibration |
| R14 | Monitoring insufficient | Medium | High | Metrics, alerts, incident runbooks |
| R15 | Scope exceeds capacity | High | Medium | MVP gates and phased delivery |

## Product-owner decisions still required
- Anonymous reporting or sign-in required?
- Public map exact or privacy-rounded coordinates?
- Original photos private? Public redacted derivatives?
- Pilot municipality and official ward-boundary source?
- Status vocabulary, reopen authority and resolution role?
- SLA by category and priority?
- Public display of reporter name (recommendation: no)?
- Launch languages: English, Hindi, other?
- Strict zero-cost requirement or approved monthly budget?
- Retention, deletion, moderation and appeal rules?
- SMS/WhatsApp in MVP or later?
- Staff invitation and directory source?

## Phase 0–4 exit status
- [x] Phase 0 repository audit.
- [x] Phase 1 HLD.
- [x] Phase 2 LLD and proposed endpoint contracts.
- [x] Phase 3 ERD, table inventory, SQL blueprint, index and RLS strategy.
- [x] Phase 4 official API documentation research.
- [ ] Authenticated provider POST smoke tests (requires owner credentials).
- [ ] Live Supabase schema introspection and migration reconciliation.
- [ ] Product-owner decisions.
- [ ] No application feature implementation in this phase.

## Next phase gate
Do not start Phase 5 foundation implementation until HLD/LLD approval, key product decisions, a verified database snapshot, API account tests or explicit provider deferrals, and a tested RLS migration plan.

This phase created design documents only. It did not alter application code, deploy services, create database tables or configure credentials.
