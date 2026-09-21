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

For the zero-cost development AI setup, use Groq server-side:

```env
AI_PROVIDER=GROQ
AI_PROVIDER_API_KEY=<your Groq key>
AI_PROVIDER_MODEL=openai/gpt-oss-20b
AI_PROVIDER_VISION_MODEL=qwen/qwen3.6-27b
TRANSCRIPTION_PROVIDER_MODEL=whisper-large-v3-turbo
```

The text model powers PDF/note summaries, briefings, concept coaching and answer feedback.
The separate vision model handles photographed notes and image extraction. Free-plan limits
are organization-wide, so local/rule-based fallbacks remain enabled and the API key stays out
of the mobile bundle.

The included `Dockerfile` installs `poppler-utils` in both the build and runtime images and runs
the HTTP + WebSocket server. Use `npm run check:pdf-renderer` before a non-container deployment;
`GET /api/health` exposes the same check without revealing credentials.

`docker-compose.production.yml` starts the HTTP/WebSocket app and the scheduler as separate
restartable processes. The one-shot migration service applies migrations and runs the idempotent
reference-data seed before either long-lived process starts. Copy `.env.production.example` to
`.env.production`, provide the database, Redis and desired provider credentials, then run
`docker compose -f docker-compose.production.yml up -d --build`.

## Single-VPS deployment

For a simple self-contained VPS deployment, use `docker-compose.vps.yml`. It provisions persistent
PostgreSQL and Redis volumes, runs Prisma migrations as a one-shot dependency before the app starts,
keeps the scheduler separate, adds Docker readiness checks, and terminates HTTPS with Caddy. The
stack also preserves the `/ws/community` WebSocket upgrade through Caddy.

On a fresh Ubuntu VPS:

```bash
cd backend
cp .env.production.example .env.production
# Edit API_DOMAIN, POSTGRES_PASSWORD, CRON_SECRET, and provider keys.
chmod +x deploy/vps/deploy.sh
./deploy/vps/deploy.sh
```

The first run obtains a TLS certificate automatically after the `API_DOMAIN` DNS A record points to
the VPS and ports 80/443 are allowed by the firewall. Do not expose port 3000 publicly. Persistent
application data lives in Docker volumes (`postgres_data`, `redis_data`, `caddy_data`, and
`caddy_config`), so back up PostgreSQL regularly and treat the VPS volume as production data.

For managed PostgreSQL/Redis, keep using `docker-compose.production.yml`; it deliberately does not
create database services and expects `DATABASE_URL` and `REDIS_URL` to point at the managed services.
The core app only requires those two infrastructure variables. AI, Razorpay, calendar, push, and
coaching integrations are optional and remain disabled until their credentials are supplied.

Readiness probe: `GET /api/health/ready` checks PostgreSQL and Redis and returns HTTP 503 until both
are reachable. Liveness/capability probe: `GET /api/health`.

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
