# CivicPulse AI — Phase 0 Project Audit

**Audit date:** 2026-10-30  
**Repository:** https://github.com/ankushdixit0001/CivicPulse-AI-Production  
**Branch inspected:** main  
**Scope:** Discovery and architecture audit only. No application implementation or production data changes.

## 1. Executive summary

The repository is not an empty project. It contains a React/Vite frontend, a Supabase Edge Function used by the deployed frontend, PostgreSQL/PostGIS schema foundations, a Python FastAPI vision service, and a legacy Express/Mongoose backend. The deployment guide explicitly identifies Supabase as the production data source and the Express/MongoDB service as legacy/local.

The main architectural risk is the coexistence of two backend/data approaches. Production must have exactly one system of record. This design selects Supabase PostgreSQL/PostGIS. The legacy MongoDB API is retained only as reference until a deliberate migration decision is made.

## 2. Inspected assets

| Path | Observed content | Audit note |
|---|---|---|
| `README.md` | Stack overview, local run steps, limitations | Explicitly says Supabase schema is not wired into legacy Node API |
| `DEPLOYMENT.md` | Production topology and checklist | Supabase Edge Function is live; Python vision service still requires external deployment |
| `frontend-app/src/App.jsx` | React app, map, report flow and API base URL | Large single-file application; needs feature/component decomposition in a later implementation phase |
| `frontend-app/package.json` | React 18, Vite, React Router, Leaflet | No TypeScript, Tailwind or test runner currently declared in this package |
| `supabase/functions/civicpulse-api/index.ts` | Supabase API, auth checks, report/media/AI flows | Large monolithic Edge Function; contains public wildcard CORS and service-role client |
| `ai-vision-service/app/main.py` | FastAPI image analysis, quality checks, optional YOLO, OpenAI vision, chat and repair comparison | Provider dependency is hard-coded to OpenAI; without key, analysis is partial and chat/repair AI unavailable |
| `ai-vision-service/requirements.txt` | FastAPI, OpenCV, Pillow, NumPy, Ultralytics, Torch, httpx | Torch/Ultralytics increase image size and cold-start burden; generic COCO YOLO is not a civic defect model |
| `ai-vision-service/Dockerfile` | Python 3.12 container | Uvicorn on configurable PORT |
| `backend-service/package.json` | Express, Mongoose, MongoDB, Socket.IO | Legacy stack, separate persistence model |
| `render.yaml` | Free Render Docker service blueprint | Declares OpenAI and vision token environment variables |
| `.env.example` | MongoDB, staff token and Gemini-related vars | Reflects legacy configuration; does not comprehensively document current Supabase variables |
| root `package.json` | npm workspaces for backend and frontend | AI service managed separately |

The repository README and deployment guide are authoritative for declared system intent, but source inspection is not a substitute for running every workflow against production.

## 3. Existing capability inventory

Legend: **Source present** = implementation code exists; **deployed** = documentation says production deployed; **verified here** = an end-to-end test was executed during this audit. No live end-to-end application test was performed for this phase.

| Capability | Evidence / status | Gap or concern |
|---|---|---|
| React frontend | Source present; deployment documented | Single large App.jsx; component boundaries and automated UI tests not established |
| Supabase Auth | Edge function calls Supabase Auth; deployment guide says email/password flow deployed | Verify signup, reset, email confirmation, token expiry and account lifecycle |
| Report submission | Edge Function source and deployment guide | Need full transactional and idempotency review |
| Image upload | Supabase Storage upload and signature checks in Edge Function | Existing bucket is documented public; privacy classification and retention policy need decision |
| Issue listing | Database query and filters in Edge Function | Code fetches pages up to 100,000 rows; should be replaced by bounded pagination/cursor |
| Votes/comments | Documented as implemented | Verify uniqueness, ownership, abuse controls and pagination |
| Staff status change | Role check against profiles role | Role vocabulary differs between source defaults and proposed roles; department/ward scoping needs formalization |
| Audit events | Issue event insertion documented | Need immutable audit semantics, actor attribution and DB-enforced workflow transitions |
| Duplicate detection | 15m same-category RPC documented | Distance-only auto-merge is unsafe; candidate + review workflow recommended |
| AI analysis | Python FastAPI source and Edge fallback source exist | Original service not deployed per DEPLOYMENT.md; provider API compatibility and actual free inference not verified |
| Repair verification | Python endpoint source and Edge fallback source exist | Needs real image-pair evaluation and explicit staff approval test |
| AI chat | Python endpoint source | Requires configured OpenAI key in current Python service |
| Generic YOLO | Optional model loading | COCO object detector cannot establish pothole/sewage/streetlight defect classification |
| Map | Leaflet/react-leaflet in frontend | Previous HLD proposed MapLibre; migration decision should be made deliberately, not silently |
| Realtime | Socket.IO dependency exists in legacy stack; Supabase Realtime available in platform | README notes live Socket.IO subscription not implemented |
| Notifications | No complete provider-backed delivery evidence in inspected source | Design required; not claimed complete |
| Analytics | Dashboard prototypes described | Real metrics, definitions and access controls need implementation |
| Staff/department/ward management | Not proven complete in inspected source | Need domain model and assignment constraints |
| SLA/escalation | Not proven complete | New design required |
| Multi-city tenancy | Not proven | New design required |
| Semantic search | No verified embedding pipeline | pgvector candidate; provider and embedding dimensions must be versioned |

## 4. Architecture and security findings

### Critical
1. **Two backend systems:** MongoDB/Mongoose legacy API and Supabase/PostgreSQL foundation are separate. Do not dual-write or direct production traffic to both.
2. **AI service deployment gap:** DEPLOYMENT.md states the FastAPI service still needs container hosting and secret configuration.
3. **AI claims must be conservative:** Generic YOLO weights are not a validated civic defect model. Model output must remain assistive.
4. **Public image bucket:** Current deployment documentation says `civic-issue-images` is public. This is only acceptable if all contents are deliberately public civic evidence and upload policy excludes sensitive content.
5. **Authorization scope:** The current Edge Function checks roles `staff` and `admin`; proposed system requires department/ward-scoped permissions and explicit municipal roles.
6. **CORS:** Edge Function source uses `Access-Control-Allow-Origin: *`. Replace with environment-driven allowed origins before broader production exposure.

### High
1. Large monolithic Edge Function should be split into domain modules while retaining one deployment boundary initially.
2. Unbounded issue listing is a scalability risk.
3. Report and AI rate limiting uses a database RPC; validate forwarded-IP trust and ensure the RPC is atomic and abuse-resistant.
4. Free community AI gateway URL found in current Edge Function is not a documented/verified production SLA provider. Do not make it a production dependency until endpoint, terms, payload compatibility, privacy, limits and real image inference are tested.
5. Frontend contains a fixed Supabase URL and a default map center. Environment-specific config and explicit no-location states are preferable.
6. The `.env.example` is not a reliable inventory of deployed environment variables.

## 5. Recommended disposition

| Existing asset | Decision |
|---|---|
| React frontend | Retain; refactor into feature modules in later phases |
| Supabase Auth / PostgreSQL / PostGIS | Retain as canonical identity and data platform |
| Supabase Edge Function | Retain as public API facade initially; modularize internally |
| Python FastAPI vision service | Retain as isolated AI/vision service; add provider adapters later |
| Generic YOLO | Optional context only; never label it a civic-defect classifier |
| Express/Mongoose backend | Freeze as legacy/reference; do not use in production |
| Public media bucket | Review and split public/private media buckets before sensitive media is supported |
| Existing 15m duplicate RPC | Preserve as candidate-generation signal, not automatic merge authority |

## 6. Phase 0 exit criteria

- [x] Main project assets inspected.
- [x] Production topology and legacy topology distinguished.
- [x] Major risks and gaps documented.
- [x] Reuse/rebuild decisions documented.
- [ ] Full existing migration SQL inventory and RLS policy review: blocked by repository directory listing not being exposed through the connected GitHub file action during this audit. The deployment guide describes the migrations, but exact migration bodies were not all fetched.
- [ ] Full end-to-end production smoke test: explicitly out of scope for Phase 0–4 and not executed.

## 7. Evidence references

- [README](../README.md)
- [Deployment guide](../DEPLOYMENT.md)
- [Frontend source](../frontend-app/src/App.jsx)
- [Supabase Edge Function](../supabase/functions/civicpulse-api/index.ts)
- [Python vision service](../ai-vision-service/app/main.py)
- [Render blueprint](../render.yaml)
