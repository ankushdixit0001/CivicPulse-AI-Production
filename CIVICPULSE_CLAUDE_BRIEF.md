# CivicPulse AI — Hackathon Project Brief

> Paste this document into Claude to generate or refine a pitch, presentation, demo script, product summary, or Q&A. Treat the implementation-status section as authoritative: do not claim incomplete features are production-ready.

## Project at a glance

**Name:** CivicPulse AI  
**Tagline:** Turn civic-issue reports into prioritized, actionable tickets.  
**Category:** Civic technology / GovTech / AI-assisted issue triage.  
**Stage:** Hackathon prototype.  
**One-sentence pitch:** CivicPulse AI gives residents a way to report local infrastructure problems with a photo and location, then helps city teams consolidate, prioritize, and track those reports in a shared ticket workflow.

## Problem

Residents often report issues through fragmented channels, while city teams need a consistent way to understand what is happening, where it is happening, how urgent it may be, and whether multiple people are reporting the same problem. This can make triage and prioritization harder. CivicPulse explores a single photo-and-location reporting workflow with an AI-assisted ticket pipeline.

## Proposed solution and intended users

CivicPulse has two intended user groups:

- **Residents:** submit an issue photo, choose/describe an issue, and share or enter its location.
- **City operations staff:** view a ticket command center, review priority and status, and update the status as work progresses.

The intended loop is **Report → Analyze → Consolidate → Triage → Track**. Resolution verification is a future concept in the current app, not a fully functioning photo-based workflow.

## What the prototype implements

### Resident-facing experience

- Landing page introduces the civic issue workflow.
- Report page accepts an image, previews the selected image, and provides browser geolocation plus editable latitude/longitude fields.
- Submits a multipart report to the Node API with the image, coordinates, issue type/description, and initial status.
- A chatbot UI sends questions to a backend chat route. It can use Gemini when configured, otherwise it has a simple keyword/fallback response mode.

### AI/vision service

- Python FastAPI service exposes `/health`, `/analyze`, and `/verify-resolution` endpoints.
- `/analyze` accepts an image and returns a detected label, confidence, estimated damage coverage, priority score, severity, bounding boxes, blur metric, and extracted EXIF metadata.
- The current service loads the checked-in YOLOv8 nano model file name and has fallback detection behavior if model loading or detections are unavailable.
- Important caveat: this is a general object detector with heuristic scoring, not evidence of a civic-issue-specific fine-tuned model. Labels may not always match the supported ticket categories.

### Backend and ticket workflow

- Node.js/Express API provides health, ticket, and chat endpoints.
- MongoDB/Mongoose ticket schema stores issue category, priority, severity, GeoJSON coordinates, status, counts, confidence, zone, timestamps, and before/after image URL fields.
- The report endpoint calls the AI service and attempts to merge an unresolved report of the same label within 15 meters; duplicate reports increment report/upvote counters.
- Ticket listing supports status, zone, and minimum-priority query filters.
- Ticket status can be updated through a PATCH endpoint.
- Socket.IO server has zone rooms and emits incident events, though the frontend is not currently subscribed to these events.

### Staff-facing experience

- Command center fetches tickets and displays summary information, a dispatch list, and status columns: Pending, Assigned, In Progress, and Resolved.
- The screen is a prototype dashboard; some controls/map elements are visual placeholders (details below).

## Architecture and data flow

1. React + Vite frontend collects report image and user-entered/browser-provided location.
2. Frontend sends a multipart request to Express (`POST /api/tickets/report`).
3. Express forwards the image to FastAPI (`/analyze`).
4. FastAPI runs detection/heuristic scoring and returns detection metadata.
5. Express attempts proximity-based duplicate consolidation (same label within 15 m), otherwise creates a Mongoose ticket.
6. MongoDB stores the ticket. The backend emits Socket.IO incident events.
7. Frontend command center fetches ticket data and renders the current board.

**Stack:** React 18, React Router, Vite, Tailwind/PostCSS, Lucide, Leaflet packages; Node.js/Express, Mongoose, Multer, Socket.IO; Python FastAPI, Ultralytics YOLO, PyTorch, OpenCV, Pillow, NumPy; MongoDB.

## Why it is useful / value proposition

- Makes issue reporting more structured by combining photo and location.
- Uses an AI-assisted signal to support triage rather than relying only on free-text reports.
- Reduces duplicate noise by grouping nearby reports of the same detected issue.
- Provides a shared ticket/status view for resident-submitted incidents.
- Creates a foundation for more transparent civic operations and measurable response workflows.

Do not invent measured impact, accuracy, time savings, or user adoption. No evaluation numbers are provided in the repository.

## Demo flow (suggested)

1. Open the landing page and explain the reporting-to-triage idea.
2. Go to the report page; select an issue photo and use geolocation or enter coordinates.
3. Submit the report and explain that the API asks the vision service for an estimated label/score.
4. Open the command center and show the ticket board and priority/status presentation.
5. Explain that nearby same-label reports are designed to consolidate into a shared ticket.
6. Show the chatbot as an optional help interface.
7. Close by honestly stating what is implemented today and what is next.

Use a test image and test environment. Do not present seeded/fallback entries as real city reports.

## Current limitations — be transparent

- Dashboard does a one-time fetch; there is no frontend live Socket.IO subscription yet.
- Map views/markers are decorative placeholders and do not render actual ticket coordinates.
- Board drag/drop and displayed filter controls are not fully implemented; status interaction may not advance tickets as the UI suggests.
- Resolution verification endpoint exists, but resolving a ticket currently calls it with empty placeholder image buffers and does not gate resolution on the verification result. Do not claim repairs are verified by before/after evidence.
- Report photos and descriptions are not durably stored in the implemented report flow; schema image URL fields are currently blank by default.
- General YOLO labels can mismatch the ticket schema's allowed labels, causing ticket creation issues for unsupported classes. The system needs civic-specific mapping/training and validation.
- Extracted EXIF is returned by vision but is not used as the stored ticket location or timestamp; submitted coordinates drive location, with a New York demo default.
- Zone assignment and fallback/sample ticket data are demo-oriented. An empty/error ticket query may return sample tickets.
- Security/operations need work before production: authentication/authorization, rate limiting, upload limits, privacy controls for photos/location, auditability, robust validation, and deployment hardening.
- Docker preview configuration may be incomplete; local development is the documented path.

## Roadmap ideas (proposals, not existing features)

1. Train/evaluate or integrate a civic-issue-specific vision model; map model output to a controlled taxonomy and show uncertainty.
2. Persist images securely, add consent/privacy rules, and let users redact sensitive image content.
3. Implement an actual map using ticket GeoJSON and zone-based live updates.
4. Add working staff assignment, drag/drop/status actions, role-based access, and an audit log.
5. Require genuine before/after uploads and make verification evidence-based, reviewable, and appealable.
6. Add report validation, upload-size limits, abuse protection, accessibility/localization, and real deployment configuration.
7. Measure model precision/recall, report-to-triage time, duplicate reduction, and resolution time in a pilot; report only verified results.

## Suggested judging criteria / evaluation plan

- **Usability:** Can a first-time resident submit a report without assistance?
- **AI quality:** Precision/recall by civic issue category on a labeled, representative test set.
- **Consolidation:** Correct duplicate grouping rate versus false merges.
- **Operational usefulness:** Time from report to staff triage and status update.
- **Trust:** Clear display of AI uncertainty, provenance, privacy, and human override.
- **Reliability/accessibility:** upload success, mobile usability, keyboard access, and performance under realistic conditions.

## Local development (from README)

1. Copy `.env.example` to `.env` and adjust values.
2. Install backend and frontend dependencies.
3. Start AI service: from `ai-vision-service`, run `uvicorn app.main:app --reload --host 0.0.0.0 --port 5000`.
4. Start backend: from `backend-service`, run `npm install && npm run dev` (port 4000 by default).
5. Start frontend: from `frontend-app`, run `npm install && npm run dev` (Vite default may differ from README's stated port; check the terminal output/config).

Root scripts include `dev:backend`, `dev:frontend`, `dev:ai`, and `build:frontend`. Backend settings include `PORT`, `MONGODB_URI`, `AI_SERVICE_URL`, `CORS_ORIGIN`, and `GEMINI_API_KEY` (or `GOOGLE_API_KEY`); frontend uses `VITE_API_BASE_URL`. Check `.env.example` against actual source before relying on every listed variable.

## Hackathon presentation message

**Core claim:** “CivicPulse AI is a prototype that turns resident-submitted issue photos and locations into AI-assisted, prioritized civic tickets, with a path to consolidate duplicates and coordinate follow-up.”

**Honest qualifier:** “The current build demonstrates the reporting, analysis, ticketing, and dashboard concept. Live map updates, reliable civic-specific classification, durable photo handling, and evidence-based repair verification are active development priorities.”

## Ask Claude to help with

Use this brief to create a polished 5–7 minute hackathon pitch deck with: (1) title, (2) problem, (3) solution, (4) user journey/demo, (5) architecture, (6) impact and evaluation plan, (7) limitations and roadmap, and (8) closing ask. Keep language clear for non-technical judges, include concise speaker notes, avoid unsupported performance claims, and mark proposed future capabilities as roadmap items rather than current features.
