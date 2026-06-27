# workers

BullMQ background workers: `pyq-extraction` (Req 7), `nta-ingestion` (Req 20), and
`billing-reconcile` (Req 9.6). Queue registration is configured in task 1.2.

## `nta-ingestion` (`ntaIngestion/`, task 17.1)

Repeatable worker that ingests official NTA announcements (JEE Main / JEE Advanced /
NEET). The source fetcher is abstracted behind the `NtaSource` interface so the concrete
RSS/scraper adapter (`httpSource.ts`) can be replaced with a fixture in tests — no live
network is used by the suite.

- `sanitize.ts` — strip scripts/HTML, normalize to plain text (Req 20.2).
- `dedupe.ts` — stable SHA-256 `dedupeHash` over content identity (Req 20.4).
- `parse.ts` — defensive parse/validate of untrusted items; malformed items are skipped
  (Req 20.3).
- `examDate.ts` — recompute `Target_Completion_Date` (= `Target_Exam_Date − Revision_Buffer`)
  and the exam countdown (Req 20.6).
- `worker.ts` — `runNtaIngestion` orchestration (pure over injected `NtaSource` +
  Prisma slice) plus the BullMQ worker/repeatable-job wiring.

The feed read endpoint (`GET /nta/feed`) is task 17.2; the property tests (Properties
44/45/46) are tasks 17.3–17.5.
