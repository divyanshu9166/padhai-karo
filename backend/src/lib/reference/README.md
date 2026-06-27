# lib/reference

Track-keyed reference-data catalog (task 3.1): the system-seeded source of truth for
Subjects, their Chapters (Chapter_Weightage, Estimated_Study_Hours, Task_Difficulty),
and the per-track Target_Exam_Date.

Authored as plain TypeScript data (no database dependency) so it can be imported by:

- the onboarding service (task 4.1) to instantiate per-user `Chapter` rows,
- the Reference Data read endpoints (task 3.2), and
- the Prisma seed (`prisma/seed.ts`) which upserts Subjects from it.

## Shape

- `REFERENCE_CATALOG: Record<ExamTrack, ReferenceSubject[]>` — JEE = Physics/Chemistry/
  Mathematics, NEET = Physics/Chemistry/Biology.
- Each `ReferenceSubject` has a stable `key` (also used as the seeded `Subject.id`) and a
  list of `ReferenceChapter` rows with a stable `referenceKey`, `weightage`,
  `estimatedStudyHours`, and `taskDifficulty`.
- `TARGET_EXAM_DATES: Record<ExamTrack, Record<year, isoDate>>` — representative future
  JEE Main (~April) and NEET (~May) dates, updated later by the NTA feed (Req 20.6).

### Weightage convention

Each chapter's `weightage` is an approximate percentage of the exam paper's marks, so
per-track totals sum to ~100. This lets the timetable engine (Req 11) allocate time
proportionally across both subjects and chapters. NEET Biology totals ~50% of the paper;
JEE spreads ~1/3 across each of its three subjects, with Calculus, Mechanics, and Organic
Chemistry carrying the highest within-subject weightage.

## Accessors

`getSubjects(track)`, `getChapters(track)` (flattened + subject-annotated),
`getAllSubjects()`, `getExamDate(track, year)`, `getExamYears(track)`, `EXAM_TRACKS`.

## Seeding

`npm run prisma:seed` (or `npx prisma db seed`, wired via the `prisma.seed` field in
package.json using `vite-node`) idempotently upserts Subjects keyed by their stable id.
Requires a reachable PostgreSQL instance (`DATABASE_URL`); safe to run repeatedly.
Chapters are NOT seeded — they are per-user instances created at onboarding from this
catalog.
