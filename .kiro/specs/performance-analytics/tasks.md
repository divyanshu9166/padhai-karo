# Implementation Plan: Performance Analytics (Phase 2)

## Overview

This plan converts the Performance Analytics design into incremental, code-only steps that extend the existing Phase 1 backend (server-side **Next.js API routes** + **PostgreSQL via Prisma**, **fast-check** property tests) without altering any shipped Phase 1 model, column, or route. Work proceeds strictly bottom-up so nothing is orphaned: first the **additive** Prisma models + migration and the year-versioned seed catalogs; then the **pure, database-free computation modules** (each paired with its fast-check property test); then the **thin service handlers** that read the user's Phase 1 rows and delegate the math; then the `withAuth`-guarded `/api/analytics/*` **route wiring**; then **integration/smoke tests**; and finally the **localization catalog additions**.

The implementation follows the established Phase 1 layering exactly: **route file** (`app/api/analytics/.../route.ts`, `withAuth`-wrapped, no logic) → **service handler** (`services/analytics/<area>Service.ts`, user-scoped Prisma reads + `assertOwnership` + active-version selection + serialization) → **pure module** (`services/analytics/<area>.ts` and `lib/analytics/*`, framework- and DB-free). It reuses the Phase 1 `lib/errors` envelope + `ErrorCode` registry, `lib/auth` `withAuth`/`assertOwnership`, `lib/localization` catalog/resolver, and the `lib/reference` seeded-catalog pattern.

Each of the design's 19 Correctness Properties is implemented as a single fast-check property test running a minimum of 100 iterations, placed beside the module it validates and tagged `// Feature: performance-analytics, Property N: ...`. Cross-cutting concerns (reference-data seeding/retention, active-year reflected in responses, schema additivity, catalog completeness, auth wiring) are covered by example/integration/smoke tests per the design's Testing Strategy. Test sub-tasks are marked optional with `*`; core implementation tasks are never optional.

Scope is strictly the four Performance Analytics capabilities and their reference data (Requirements 1–16). No Mobile_Client screens or other Phase 2 specs are implemented here; localization strings are added to the shared catalog so the existing client resolver can render them.

## Tasks

- [x] 1. Additive schema, migration, and year-versioned reference seed
  - [x] 1.1 Add additive enums and models to the Prisma schema and generate the migration
    - Add enums `MockSeriesSource`, `CutoffUnit`, `ReferenceDatasetType` and models `ExternalMockScore`, `TargetCollegeCutoffSelection`, `QuestionTopicMap`, `CutoffReferenceData`, `ScoreStandingMap`, `TopicFrequencyReferenceData` exactly as specified in Data Models, with `userId` + cascade on user-owned models and the listed `@@unique`/`@@index` constraints; leave every Phase 1 enum/model/column unchanged; generate and run the migration
    - _Requirements: 1.1, 4.1, 5.1, 6.1, 6.2, 11.1, 13.3_
  - [x] 1.2 Author the year-versioned cutoff and score-standing TypeScript catalogs
    - Create `lib/analytics/cutoffCatalog.ts` holding JoSAA (JEE) / NEET closing data and the JEE-percentile / NEET-marks `ScoreStandingMap` bands, keyed by `(examTrack, referenceDataYear)` with `closingValue`/`unit` and `[minScorePercent, maxScorePercent] → [estimateLow, estimateHigh]` bands
    - _Requirements: 5.1, 3.1, 3.2_
  - [x] 1.3 Author the year-versioned topic-frequency TypeScript catalog
    - Create `lib/analytics/topicFrequencyCatalog.ts` with one `Topic_Frequency_Record` per topic keyed by `(examTrack, referenceDataYear)`, each carrying `topicKey` (== Phase 1 `Chapter.referenceKey`), `appearanceCount`, `yearSpanStart`/`yearSpanEnd`, and `avgQuestionsPerYear`
    - _Requirements: 6.1, 6.2_
  - [x] 1.4 Author the question→topic map catalog
    - Create `lib/analytics/questionTopicMapCatalog.ts` mapping seeded `PYQ.id` values to `(examTrack, subjectId, topicKey)` so Chapter/Topic-level weak areas are derivable without touching the Phase 1 `PYQ` model
    - _Requirements: 11.1, 13.3_
  - [x] 1.5 Extend `prisma/seed.ts` to upsert all analytics reference data idempotently
    - Upsert cutoff, score-standing, topic-frequency, and question-topic-map rows by their natural keys so re-seeding is idempotent and loading a later `referenceDataYear` retains prior years' rows
    - _Requirements: 5.1, 5.3, 6.1, 6.4_
  - [x]* 1.6 Smoke tests for the seeded reference data
    - Assert cutoff and topic-frequency rows exist keyed by `(examTrack, referenceDataYear)` with `appearanceCount`, year span, and `avgQuestionsPerYear` populated, and that seeding year `N` then `N+1` retains both
    - _Requirements: 5.1, 5.3, 6.1, 6.2, 6.4_
  - [x]* 1.7 Schema-additivity test
    - Verify the migration adds only new enums/models/columns and leaves every Phase 1 model and column unchanged (migration/schema-diff review)
    - _Requirements: 13.1, 13.3_

- [x] 2. Active reference-data version resolver
  - [x] 2.1 Implement the active-version resolver
    - Create `lib/analytics/referenceVersion.ts` returning the maximum (most recent) `referenceDataYear` available for a `(examTrack, datasetType)`, shared by every reference reader
    - _Requirements: 5.2, 6.3_
  - [x]* 2.2 Property test: active reference-data version selection
    - **Property 8: Active reference-data version selection**
    - **Validates: Requirements 5.2, 6.3**

- [x] 3. Tier-gating seam
  - [x] 3.1 Implement the tier gate
    - Create `services/analytics/tierGate.ts` exporting an empty-by-default `PAID_ANALYTICS_OUTPUTS` registry and `assertTierAllowed(output, tier)` returning `402 UPGRADE_REQUIRED` only for FREE-tier requests of a designated-paid output
    - _Requirements: 16.1, 16.2, 16.3_
  - [x]* 3.2 Property test: tier-gating decision
    - **Property 19: Tier-gating decision**
    - **Validates: Requirements 16.1, 16.2, 16.3**

- [x] 4. External mock score validation (pure)
  - [x] 4.1 Implement mock-score validation
    - Create `services/analytics/mockScoreValidation.ts`: accept iff `maxScore > 0` and `0 ≤ obtainedScore ≤ maxScore` and `testDate ≤ now` and (when `source = OTHER`) `sourceName` non-blank; otherwise return a `VALIDATION_ERROR` naming the offending field
    - _Requirements: 1.2, 1.3, 1.4_
  - [x]* 4.2 Property test: external mock score validation boundaries
    - **Property 1: External mock score validation boundaries**
    - **Validates: Requirements 1.2, 1.3, 1.4**

- [x] 5. Score trajectory normalization (pure)
  - [x] 5.1 Implement trajectory assembly and normalization
    - Create `services/analytics/trajectory.ts`: a pure function of `(mockScores, pyqAttempts, timedAttempts, range)` producing one labeled `ScoreDataPoint` per source row (source ∈ EXTERNAL_MOCK/PYQ_ATTEMPT/TIMED_PAPER_ATTEMPT), `normalizedPercent = max>0 ? obtained/max*100 : 0`, inclusive `[from,to]` filter, ascending date sort, `[]` on empty input
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x]* 5.2 Property test: score trajectory assembly, normalization, labeling, and filtering
    - **Property 3: Score trajectory assembly, normalization, labeling, and filtering**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

- [x] 6. Rank prediction (pure)
  - [x] 6.1 Implement rank prediction
    - Create `services/analytics/rankPrediction.ts`: take the most recent `RECENT_POINTS_WINDOW` points, return `INSUFFICIENT_DATA` with `minimumRequired = MIN_SCORE_POINTS` below threshold, else map the representative mean through the active `ScoreStandingMap` band (clamped to nearest) returning `{ low ≤ high, unit }` (PERCENTILE for JEE, MARKS for NEET) plus `referenceDataYear`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x]* 6.2 Property test: rank prediction maps recent points to a standing band
    - **Property 4: Rank prediction maps recent points to a standing band**
    - **Validates: Requirements 3.1, 3.2, 3.3**
  - [x]* 6.3 Property test: rank prediction insufficient-data threshold
    - **Property 5: Rank prediction insufficient-data threshold**
    - **Validates: Requirements 3.4**

- [x] 7. Score-improvement gap (pure)
  - [x] 7.1 Implement score-gap computation
    - Create `services/analytics/scoreGap.ts`: given a `RankPredictionResult` and a target `(closingValue, unit)`, compare directionally (lower-is-better for RANK, higher-is-better for PERCENTILE/MARKS), returning `MET` with `margin`, `GAP` with `gap`, or propagating `INSUFFICIENT_DATA`, always including `referenceDataYear`
    - _Requirements: 4.2, 4.3, 4.5_
  - [x]* 7.2 Property test: score-improvement gap and met-margin
    - **Property 7: Score-improvement gap and met-margin**
    - **Validates: Requirements 4.2, 4.3**

- [x] 8. Topic trend projection (pure)
  - [x] 8.1 Implement topic-trend projection and ordering
    - Create `services/analytics/topicTrend.ts`: left-join the track topic universe against the active topic-frequency dataset, project `appearanceCount`/`yearSpan`/`avgQuestionsPerYear`/`hasFrequencyData=true` when present, zero-fill (`hasFrequencyData=false`) otherwise, sort descending by `avgQuestionsPerYear` (stable tiebreak by name)
    - _Requirements: 7.1, 7.2, 7.3_
  - [x]* 8.2 Property test: topic trend projection, zero-fill, and ordering
    - **Property 9: Topic trend projection, zero-fill, and ordering**
    - **Validates: Requirements 7.1, 7.2, 7.3**

- [x] 9. Attempt quality (pure)
  - [x] 9.1 Implement attempt-quality computation
    - Create `services/analytics/attemptQuality.ts`: from `perQuestion` outcomes + optional `timeTakenSec` compute `accuracyPercent` (`correct/attempted*100`, `0` when none attempted), `unattemptedCount`, `attemptRate`, and `averageTimePerQuestion` (`timeTaken/total` or `null` when no time); read-only, never mutates
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  - [x]* 9.2 Property test: attempt quality metrics
    - **Property 11: Attempt quality metrics**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**

- [x] 10. Attempt quality trend (pure)
  - [x] 10.1 Implement attempt-quality-trend computation
    - Create `services/analytics/attemptQualityTrend.ts` (building on `attemptQuality`): map in-range attempts to date-ascending `AttemptQualityPoint`s, return `INSUFFICIENT_DATA` (`minimumRequired: 2`) below two points, else compute accuracy/attempt-rate directions (INCREASED/DECREASED/UNCHANGED) from latest vs earliest; apply the optional subject filter over `PYQ.subjectId`, dropping attempts with no questions for that subject
    - _Requirements: 10.1, 10.3, 10.4, 10.5_
  - [x]* 10.2 Property test: attempt quality trend series, direction, subject filter, and insufficient-data
    - **Property 13: Attempt quality trend series, direction, subject filter, and insufficient-data**
    - **Validates: Requirements 10.1, 10.3, 10.4, 10.5**

- [x] 11. Weak-area detection and ranking (pure)
  - [x] 11.1 Implement weak-area derivation and session-type distribution
    - Create `services/analytics/weakArea.ts`: aggregate per-question outcomes at Subject/Chapter/Topic (Topic/Chapter only for questions with a `topicKey`), fold in per-`Mistake_Category` counts, exclude buckets with no outcomes and no mistakes, and sum `FocusSession.focusedDurationMin` per `Session_Type`; read-only over already-read rows
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
  - [x] 11.2 Implement weak-area scoring, ranking, and per-Topic score map
    - Extend `weakArea.ts`: compute `weakAreaScore` from error rate + weighted mistake counts, order descending by score with `incorrectCount`-descending tiebreak, and export the per-Topic `weakAreaScore` map for prioritization
    - _Requirements: 12.1, 12.2, 12.3_
  - [x]* 11.3 Property test: weak-area derivation, category counts, and exclusion
    - **Property 14: Weak-area derivation, category counts, and exclusion**
    - **Validates: Requirements 11.1, 11.2, 11.4**
  - [x]* 11.4 Property test: session-type study-time distribution
    - **Property 15: Session-type study-time distribution**
    - **Validates: Requirements 11.3**
  - [x]* 11.5 Property test: weak-area ranking and tiebreak
    - **Property 16: Weak-area ranking and tiebreak**
    - **Validates: Requirements 12.1, 12.3**

- [x] 12. Topic prioritization (pure)
  - [x] 12.1 Implement topic prioritization
    - Create `services/analytics/topicPriority.ts`: a pure function of `(topicFrequencies, weakAreaScoreByTopic)` computing `priority = wFreq*norm(avgQuestionsPerYear) + wWeak*norm(weakAreaScore)`, flag `isHighFreqAndWeak` when at/above `HIGH_FREQUENCY_THRESHOLD` and among weak areas, reduce to frequency alone when no weak areas, order descending by priority
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - [x]* 12.2 Property test: topic prioritization combination, ordering, flag, and no-weak-areas fallback
    - **Property 10: Topic prioritization combination, ordering, flag, and no-weak-areas fallback**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**

- [x] 13. Input-immutability guarantee
  - [x]* 13.1 Property test: analytics computation does not mutate Phase 1 inputs
    - **Property 12: Analytics computation does not mutate Phase 1 inputs**
    - Freeze/deep-clone input attempt, mistake, and focus-session rows and assert they are deep-equal after `computeAttemptQuality` and weak-area computation
    - **Validates: Requirements 9.5, 11.5, 13.2**

- [x] 14. Checkpoint - Ensure all pure-module tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. External mock score service (Req 1, 14)
  - [x] 15.1 Implement mock-score CRUD handler
    - Create `services/analytics/mockScoreService.ts`: create/list/edit/delete scoped by `ctx.user.id`, run `mockScoreValidation` on create and on the merged record for edits, and `assertOwnership` on `:id` before edit/delete
    - _Requirements: 1.1, 1.5, 14.2, 14.3_
  - [x]* 15.2 Property test: external mock score persistence round-trip
    - **Property 2: External mock score persistence round-trip** (mocked/in-memory Prisma via `vi.mock('@/lib/db')`)
    - **Validates: Requirements 1.1, 1.5**

- [x] 16. Score trajectory service (Req 2)
  - [x] 16.1 Implement the trajectory handler
    - Create `services/analytics/scoreTrajectoryService.ts`: load the user's `ExternalMockScore`, `PYQAttempt`, and `TimedPaperAttempt` rows scoped by `ctx.user.id`, pass them with the optional date range to `trajectory`, and serialize the points
    - _Requirements: 2.1, 13.1, 14.2_

- [x] 17. Rank prediction service (Req 3, 5)
  - [x] 17.1 Implement the rank-prediction handler
    - Create `services/analytics/rankPredictionService.ts`: read `Profile.examTrack`, resolve the active `ScoreStandingMap` year (`503 REFERENCE_DATA_UNAVAILABLE` when none), build the user's recent points, call `rankPrediction`, and include the `referenceDataYear`
    - _Requirements: 3.1, 3.2, 3.5, 5.2, 5.4, 14.2_
  - [x]* 17.2 Example test: reference-year reflected and reference-unavailable
    - With multiple seeded years assert the max year is returned; with no rows for a track assert `503 REFERENCE_DATA_UNAVAILABLE`
    - _Requirements: 3.5, 5.4_

- [x] 18. Target-cutoff selection and score-gap service (Req 4, 5)
  - [x] 18.1 Implement cutoff listing and target-cutoff selection handler
    - Create `services/analytics/cutoffService.ts`: list active-dataset cutoffs for the user's track (`503` when none), and `GET`/`PUT` the user's single `TargetCollegeCutoffSelection` validating that `cutoffReferenceId` belongs to the active dataset (`404`/`403` otherwise)
    - _Requirements: 4.1, 5.1, 5.2, 5.4, 14.2, 14.3_
  - [x] 18.2 Implement the score-gap handler
    - Create `services/analytics/scoreGapService.ts`: require a selection (`422 TARGET_CUTOFF_REQUIRED` otherwise), compute the current rank prediction, delegate to `scoreGap`, and include the cutoff `referenceDataYear`
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 14.2_
  - [x]* 18.3 Example test: target-cutoff-required and reference-year reflected
    - Score-gap with no selection → `422 TARGET_CUTOFF_REQUIRED`; result carries the active cutoff `referenceDataYear`
    - _Requirements: 4.4, 4.5_
  - [x]* 18.4 Property test: target cutoff selection round-trip
    - **Property 6: Target cutoff selection round-trip** (mocked Prisma)
    - **Validates: Requirements 4.1**

- [x] 19. Topic trend service (Req 6, 7)
  - [x] 19.1 Implement the topic-trend handler
    - Create `services/analytics/topicTrendService.ts`: read the track topic universe (`lib/reference`), resolve the active `TopicFrequencyReferenceData` year (`503` when none), delegate to `topicTrend`, include `referenceDataYear`
    - _Requirements: 7.1, 6.3, 5.4, 14.2_

- [x] 20. Topic prioritization service (Req 8, 12)
  - [x] 20.1 Implement the topic-priority handler
    - Create `services/analytics/topicPriorityService.ts`: obtain the per-Topic `weakAreaScore` map from the weak-area service and the active topic frequencies, delegate to `topicPriority`, include `referenceDataYear`
    - _Requirements: 8.1, 12.2, 6.3, 5.4, 14.2_
  - [x]* 20.2 Example test: weak-area score map feeds prioritization
    - Assert the per-Topic `weakAreaScore` map produced by weak-area detection is consumed by topic prioritization
    - _Requirements: 12.2_

- [x] 21. Attempt quality service (Req 9, 14)
  - [x] 21.1 Implement the attempt-quality handler
    - Create `services/analytics/attemptQualityService.ts`: load the attempt by `(type, attemptId)`, `assertOwnership`, and pass its persisted outcomes (and time for TIMED) to `computeAttemptQuality` without modifying the row
    - _Requirements: 9.1, 9.5, 14.2, 14.3_

- [x] 22. Attempt quality trend service (Req 10)
  - [x] 22.1 Implement the quality-trend handler
    - Create `services/analytics/attemptQualityTrendService.ts`: load the user's in-range attempts (optional `subjectId`/`from`/`to`), delegate to `attemptQualityTrend`, returning a payload distinct from the score trajectory
    - _Requirements: 10.1, 10.2, 10.4, 14.2_
  - [x]* 22.2 Example test: quality trend is a distinct payload from the score trajectory
    - **Validates: Requirements 10.2**

- [x] 23. Weak-area service (Req 11, 12, 13)
  - [x] 23.1 Implement the weak-area handler
    - Create `services/analytics/weakAreaService.ts`: read the user's `PYQAttempt`/`TimedPaperAttempt` outcomes, `MistakeJournalEntry`, and `FocusSession` rows, resolve `subjectId` via `PYQ` and `topicKey` via `QuestionTopicMap`, delegate to `weakArea`, and expose the per-Topic score map; never writes a Phase 1 row
    - _Requirements: 11.1, 11.3, 11.5, 12.2, 13.1, 14.2_

- [x] 24. Per-user isolation guarantee
  - [x]* 24.1 Property test: per-user isolation of analytics outputs
    - **Property 17: Per-user isolation of analytics outputs** (drive handlers with mocked Prisma; assert outputs depend only on the requesting user's rows)
    - **Validates: Requirements 14.2**

- [x] 25. Checkpoint - Ensure all service tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 26. Route wiring for `/api/analytics/*` (Req 14)
  - [x] 26.1 Wire the mock-score routes
    - Add `app/api/analytics/mock-scores/route.ts` (POST/GET) and `mock-scores/[id]/route.ts` (PATCH/DELETE), each `withAuth`-wrapped and calling the gate then `mockScoreService`
    - _Requirements: 1.1, 1.5, 14.1_
  - [x] 26.2 Wire the trajectory and rank-prediction routes
    - Add `app/api/analytics/score-trajectory/route.ts` and `rank-prediction/route.ts`, `withAuth`-wrapped, calling the gate then their services
    - _Requirements: 2.1, 3.1, 14.1_
  - [x] 26.3 Wire the cutoff, target-cutoff, and score-gap routes
    - Add `app/api/analytics/cutoffs/route.ts`, `target-cutoff/route.ts` (GET/PUT), and `score-gap/route.ts`, `withAuth`-wrapped
    - _Requirements: 4.1, 4.2, 14.1_
  - [x] 26.4 Wire the topic-trends and topic-priority routes
    - Add `app/api/analytics/topic-trends/route.ts` and `topic-priority/route.ts`, `withAuth`-wrapped
    - _Requirements: 7.1, 8.1, 14.1_
  - [x] 26.5 Wire the attempt-quality and quality-trend routes
    - Add `app/api/analytics/attempts/[attemptId]/quality/route.ts` and `attempt-quality-trend/route.ts`, `withAuth`-wrapped
    - _Requirements: 9.1, 10.1, 14.1_
  - [x] 26.6 Wire the weak-areas route
    - Add `app/api/analytics/weak-areas/route.ts`, `withAuth`-wrapped, calling the gate then `weakAreaService`
    - _Requirements: 11.1, 14.1_

- [x] 27. Localization catalog additions (Req 15)
  - [x] 27.1 Add the `analytics.*` strings to the localized catalog
    - Extend `lib/localization/catalog.ts` with EN and HI values for all new analytics labels/messages (source names, axis labels, insufficient-data / reference-unavailable / target-required messages, priority and weak-area labels) under an `analytics.*` namespace
    - _Requirements: 15.1, 15.3_
  - [x]* 27.2 Property test: localized analytics strings fall back to English
    - **Property 18: Localized analytics strings fall back to English**
    - **Validates: Requirements 15.2**
  - [x]* 27.3 Catalog-completeness smoke test
    - Assert every `analytics.*` key has an `en` value and audit Hindi coverage
    - _Requirements: 15.3_

- [x] 28. Integration and smoke tests
  - [x]* 28.1 Endpoint integration tests over seeded Phase 1 rows
    - Full request/response cycles for mock-score CRUD, score trajectory, rank prediction, target-cutoff selection, score gap, topic trends, topic priority, attempt quality, quality trend, and weak areas, each computed from seeded Phase 1 rows to confirm Phase 1 data is the primary input
    - _Requirements: 13.1_
  - [x]* 28.2 Auth and isolation integration tests
    - Every `/api/analytics/*` route rejects a tokenless request with `401`; a request referencing another user's mock score / attempt / selection returns `403`
    - _Requirements: 14.1, 14.3_
  - [x]* 28.3 Reference-data retention integration test
    - Seed year `N` then `N+1`, assert both are retained and the active reader uses `N+1` for rank prediction / score gap / topic trends
    - _Requirements: 5.3, 6.4_

- [x] 29. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each of Properties 1–19 is a single fast-check property test running a minimum of 100 iterations, tagged `// Feature: performance-analytics, Property N: ...`, placed beside the module it validates: P1 (4.2), P2 (15.2), P3 (5.2), P4 (6.2), P5 (6.3), P6 (18.4), P7 (7.2), P8 (2.2), P9 (8.2), P10 (12.2), P11 (9.2), P12 (13.1), P13 (10.2), P14 (11.3), P15 (11.4), P16 (11.5), P17 (24.1), P18 (27.2), P19 (3.2).
- All 16 requirements are covered: Req 1 (Epics 1, 4, 15, 26), Req 2 (Epics 5, 16, 26), Req 3 (Epics 6, 17, 26), Req 4 (Epics 7, 18, 26), Req 5 (Epics 1, 2, 17, 18, 28), Req 6 (Epics 1, 2, 19, 28), Req 7 (Epics 8, 19, 26), Req 8 (Epics 12, 20, 26), Req 9 (Epics 9, 21, 26), Req 10 (Epics 10, 22, 26), Req 11 (Epics 11, 23, 26), Req 12 (Epics 11, 20), Req 13 (Epics 1, 13, 23, 28), Req 14 (Epics 15–24, 26, 28), Req 15 (Epic 27), Req 16 (Epic 3).
- The bottom-up order keeps every layer integrated: pure modules are exercised by their services, services by their routes, and routes by integration tests, so no code is orphaned.
- Checkpoints (Epics 14, 25, 29) provide incremental validation points.
- All new Prisma models, columns, and enums are additive; no Phase 1 model/column/route is altered (Req 13.3), enforced structurally by DB-free pure modules and read-only service handlers.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "27.1"] },
    { "id": 2, "tasks": ["1.5", "2.1", "3.1", "4.1", "5.1", "6.1", "8.1", "9.1", "11.1"] },
    { "id": 3, "tasks": ["1.6", "1.7", "2.2", "3.2", "4.2", "5.2", "6.2", "6.3", "7.1", "8.2", "9.2", "10.1", "11.2", "27.2", "27.3"] },
    { "id": 4, "tasks": ["7.2", "10.2", "11.3", "11.4", "11.5", "12.1", "13.1"] },
    { "id": 5, "tasks": ["12.2", "15.1", "16.1", "17.1", "18.1", "19.1", "21.1", "22.1", "23.1"] },
    { "id": 6, "tasks": ["15.2", "17.2", "18.2", "20.1", "24.1"] },
    { "id": 7, "tasks": ["18.3", "18.4", "20.2", "22.2", "26.1", "26.2", "26.3", "26.4", "26.5", "26.6"] },
    { "id": 8, "tasks": ["28.1", "28.2", "28.3"] }
  ]
}
```
