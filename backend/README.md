# JEE/NEET Study Companion — Backend

Server-side-only **Next.js (App Router) API** service for the Phase 1 MVP. There is **no web
frontend**; the only user-facing surface is the React Native (Expo) `mobile/` client (added in
task group 21). This service owns persistence, scoring, generation algorithms, quota accounting,
and authorization.

## Stack

- **Next.js 14 (App Router)** — API route handlers only, under `src/app/api/**`.
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
```

## Environment

Copy `.env.example` to `.env.local` and fill in values. All secrets are server-side only and
must never be bundled into the mobile client (see task 1.2).
