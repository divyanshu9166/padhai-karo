# Padhai Karo — Backend

Server-side-only **Next.js (App Router) API** service for the Padhai Karo MVP. The first launch
supports UPSC CSE and SSC CGL program/stage selections; the prior JEE/NEET path remains available
for compatibility. There is **no web frontend**; the only user-facing surface is the React Native
(Expo) `mobile/` client. This service owns persistence, scoring, generation algorithms, quota
accounting, and authorization.

## Stack

- **Next.js 16 (App Router)** — API route handlers only, under `src/app/api/**`.
- **TypeScript** (strict).
- **Vitest + fast-check** — property-based tests run a minimum of **100 iterations** by default
  (configured in `vitest.setup.ts`).
- ESLint (`eslint-config-next` + Prettier) and Prettier for formatting.
- PostgreSQL via Prisma, Redis + BullMQ workers — wired in tasks 1.2 / 1.3.

## Folder layout

```
backend/
  src/
    app/api/         Next.js API route handlers (thin; delegate to services)
      health/        Liveness probe (sample endpoint)
    services/        Feature service modules (business logic orchestration)
    workers/         BullMQ workers: pyq-extraction, nta-ingestion, billing-reconcile
    lib/
      errors/        Shared JSON error-envelope helper { error: { code, message, details? } }
      auth/          Password hashing, sessions, route guard (task group 2)
      scoring/       Pure PYQ / timed-paper scoring (task group 11)
      timetable/     Timetable generation pipeline (task group 6)
      localization/  EN/HI catalog + resolver (task group 19)
  tests/             Cross-cutting / harness tests
```

## Scripts

```bash
npm run dev        # start the dev server
npm run build      # production build
npm run start      # run the production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run test       # vitest run (property + unit tests)
npm run current-affairs:refresh # one verified PIB RSS ingestion pass
npm run worker:scheduler         # recurring current-affairs, briefing, calendar and push jobs
npm run pyq:prepare              # download allow-listed official UPSC/SSC source documents
npm run pyq:import               # import a reviewed final-key JSON atomically
```

## Environment

Copy `.env.example` to `.env.local` and fill in values. All secrets are server-side only and
must never be bundled into the mobile client. Optional provider capability status is available
from `GET /api/health`; the scheduler is a long-lived worker and must be run by the deployment
platform (or replaced with a platform cron calling the secret-gated endpoints).

`npm run start` uses `server.ts`, which serves Next.js and the authenticated `/ws/community`
WebSocket endpoint together. Deploy this process on a long-lived Node host for real-time
community messaging; the HTTP message endpoints remain the safe delta-polling fallback for
serverless deployments.

PDF page images are rendered by the native Poppler `pdftoppm` binary through
`GET /api/pdf-documents/:id/pages/:page`. Install Poppler on the deployment image or set
`PDF_RENDERER_BIN` to its absolute executable path. The route is authenticated and removes its
short-lived temporary files after every render.

The included `Dockerfile` installs `poppler-utils` in both the build and runtime images and runs
the HTTP + WebSocket server. Use `npm run check:pdf-renderer` before a non-container deployment;
`GET /api/health` exposes the same check without revealing credentials.

`docker-compose.production.yml` starts the HTTP/WebSocket app and the scheduler as separate
restartable processes. Copy `.env.production.example` to `.env.production`, provide the database,
Redis and desired provider credentials, then run `docker compose -f docker-compose.production.yml
up -d --build`.

The offline workspace endpoint is cursor-paginated across timetable blocks, resources, PDFs,
annotations, voice notes and calendar events. The mobile client persists the cursor checkpoint,
skips already downloaded files, retries failed items independently and exposes pause/resume
progress; PDF uploads are checksum-idempotent for reconnect retries.

For real-time community messaging, deploy the Docker image as a long-lived Node service and run
`npm run worker:scheduler` as a separate long-lived worker. Serverless deployments continue to
use the authenticated HTTP delta-polling fallback and platform cron routes. AI, transcription,
Google Calendar and push delivery remain opt-in integrations and are never enabled by guessed
credentials.

## Verified data policy

`data/official-pyq-sources.json` and `data/README.md` define the official-PYQ workflow. Question
paper PDFs alone are not imported as answerable questions: an operator must review the official
final answer key and provide normalized four-option JSON. This prevents an unverified coaching key
from reaching mock scoring. `GET /api/admin/pyq/status` reports whether a track has an eligible
corpus. Current affairs default to the official PIB RSS feed and can be refreshed by the CLI or
scheduler.
