# Implementation Plan: Weightage-Based Time Allocation

## Overview

This plan implements the Allocation_Service as a purely additive, reuse-only feature on the
existing Next.js + Prisma backend. Work proceeds bottom-up: first the additive Prisma models,
localization keys, and tier-gate identifiers; then the pure, DB-free `src/lib/allocation/*`
modules (the property-test surface) for frequency, signal, ranking, suggested allocation, and
timetable-basis selection; then the thin `src/services/allocation/*` handlers and
`src/app/api/allocation/*` routes that read through Prisma and reuse `withAuth`, the active
reference-year resolver, localization, and the tier gate; and finally the additive augmentation
of the existing timetable generator. Each pure module ships with its property tests close to the
implementation so universal properties are validated early, and services are wired together with
isolation, mutation-safety, missing-input, gating, and localization properties before the
timetable integration closes the loop.

All code is TypeScript, tested with Vitest and fast-check (the project's existing stack), run as
a single pass with `npx vitest --run`.

## Tasks

- [x] 1. Add additive data models and apply migration
  - [x] 1.1 Add the new Prisma enum, models, and back-relations
    - Add `enum EffectiveAllocationMode { SUGGESTED, PHASE1_DEFAULT }` to `backend/prisma/schema.prisma`
    - Add `model AllocationPreference` (uuid id, unique userId, mode default PHASE1_DEFAULT, timestamps, cascade-delete User relation, userId index)
    - Add `model SuggestedAllocationSnapshot` (uuid id, unique userId, referenceDataYear Int, shares Json, computedAt, timestamps, cascade-delete User relation, userId index)
    - Add the two additive back-relations on `User` (`allocationPreference`, `suggestedAllocationSnapshot`) only; change no existing column, type, or stored value
    - _Requirements: 9.3, 7.1, 7.6_

  - [x] 1.2 Generate and apply the Prisma migration
    - Run the project's Prisma migration command to create a new migration adding only the enum and the two new models
    - Regenerate the Prisma client
    - _Requirements: 9.3_

  - [x]* 1.3 Write smoke test asserting the migration is purely additive
    - Assert the generated migration SQL creates only the new enum and the two new tables and alters no existing Phase 1 / Performance Analytics table, column, or type
    - _Requirements: 9.3, 9.4_

- [x] 2. Register localization strings and tier-gate identifiers
  - [x] 2.1 Add `allocation.*` localized strings to the catalog
    - Add EN and HI values for every new user-facing allocation label/message (most-frequent headings, suggested-allocation labels, fallback/“no historical data” labels, mode labels, reference-data-unavailable message) to `backend/src/lib/localization/catalog.ts`
    - _Requirements: 11.2, 11.3, 11.4_

  - [x]* 2.2 Write smoke test for `allocation.*` catalog completeness
    - Assert every `allocation.*` key has a non-empty `en` and a non-empty `hi` value (mirror `analyticsCatalog.smoke.test.ts`)
    - _Requirements: 11.4_

  - [x] 2.3 Add allocation tier-gate output identifiers
    - Add tier-gate identifiers for the allocation outputs in `backend/src/services/analytics/tierGate.ts`, leaving them OUT of the Paid set so every tier is granted by default
    - _Requirements: 12.1, 12.4_

- [x] 3. Implement pure frequency module
  - [x] 3.1 Implement `src/lib/allocation/frequency.ts`
    - Define `AttemptQuestionOutcome`, `QuestionTopicLink`, `AllocationChapter`, `TopicFrequencyRecord`, `HistoricalFrequency` types
    - Implement `pyqChapterFrequency(outcomes, links, chapters)` counting owned per-question outcomes resolved via `topicKey === referenceKey`, unmapped questions excluded, multi-match increments each matched chapter once, each outcome counted at most once per chapter, empty → zero everywhere
    - Implement `historicalChapterFrequency(chapters, records)` returning `avgQuestionsPerYear` or `{ value: 0, hasHistoricalData: false }`
    - Read defensively (malformed/empty inputs never throw); never mutate inputs
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.3, 2.4_

  - [x]* 3.2 Write property test for PYQ chapter frequency
    - **Property 1: PYQ_Chapter_Frequency counts mapped, owned per-question outcomes**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

  - [x]* 3.3 Write property test for historical chapter frequency
    - **Property 2: Historical_Chapter_Frequency equals active-year average or zero**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**

- [x] 4. Implement pure combined-signal module
  - [x] 4.1 Implement `src/lib/allocation/signal.ts`
    - Define `ChapterSignalInput`, `ChapterSignal`, and `SIGNAL_WEIGHTS` (positive weights)
    - Implement `combinedWeightageSignal(inputs)` computing `rawSignal = WPYQ*pyq + WHIST*hist` (non-negative, non-decreasing in each input) and min-max normalizing onto `[0,1]` (max→1, min→0, all-equal/all-zero→0)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x]* 4.2 Write property test for signal non-negativity and monotonicity
    - **Property 3: Combined_Weightage_Signal is non-negative and monotonic**
    - **Validates: Requirements 3.1, 3.3, 3.4, 3.5**

  - [x]* 4.3 Write property test for signal normalization
    - **Property 4: Combined_Weightage_Signal normalizes onto [0,1]**
    - **Validates: Requirements 3.2, 3.5**

- [x] 5. Implement pure ranking module
  - [x] 5.1 Implement `src/lib/allocation/ranking.ts`
    - Implement `mostFrequentChapters(signals)` ordering by `combinedWeightageSignal` desc, tie-broken by `historicalFrequency` desc, then `pyqFrequency` desc, then `referenceKey` ascending lexicographic; empty → empty
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6_

  - [x]* 5.2 Write property test for deterministic total ordering
    - **Property 5: Most_Frequent_Chapters ordering is total and deterministic**
    - **Validates: Requirements 4.1, 4.3, 4.4, 4.5, 4.6**

- [x] 6. Implement pure suggested-allocation module
  - [x] 6.1 Implement `src/lib/allocation/allocation.ts`
    - Define `SuggestedChapterInput`, `AllocationSource`, `ChapterAllocationShare`
    - Implement `suggestedTimeAllocation(inputs)`: consider only pending chapters (NOT_STARTED | IN_PROGRESS), apply overrides first, distribute remaining share `clamp(1 - Σoverrides, 0, 1)` by signal, fall back to Phase 1 weightage proportions when signals are all zero or per-chapter data-less, give weightage-absent/zero fallback chapters the smallest non-zero share (retain, never drop), round shares to 4 dp with the largest share absorbing residue so they sum to 1.0 (±0.001); label each share source; preserve `weightageIsDefault`; empty pending → []
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 8.1, 8.5, 8.6, 8.7_

  - [x]* 6.2 Write property test for proportional shares summing to one
    - **Property 7: Suggested allocation shares are proportional and sum to one**
    - **Validates: Requirements 5.1, 5.3, 6.1**

  - [x]* 6.3 Write property test for pending-chapter coverage
    - **Property 8: Suggested allocation covers exactly the pending Chapters once**
    - **Validates: Requirements 5.2, 6.4, 5.5**

  - [x]* 6.4 Write property test for weightage fallback labeling and retention
    - **Property 9: Chapter_Weightage fallback retains and labels data-less Chapters**
    - **Validates: Requirements 5.4, 6.1, 6.2, 6.3, 6.5**

  - [x]* 6.5 Write property test for override precedence and remainder distribution
    - **Property 10: User overrides take precedence and the remainder is distributed by signal**
    - **Validates: Requirements 8.1, 8.2, 8.5, 8.6, 8.7**

- [x] 7. Implement pure timetable-basis module
  - [x] 7.1 Implement `src/lib/allocation/timetableBasis.ts`
    - Define `EffectiveAllocationMode` and `resolveTimetableBasis(chapters, mode, snapshotShares)`: when SUGGESTED and snapshot has ≥1 pending chapter, rewrite each pending chapter's in-memory `weightage` to its snapshot share (chapters absent from snapshot keep Phase 1 weightage); otherwise return Phase 1 weightage unchanged; never mutate persisted/input values
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 7.6, 7.7_

  - [x]* 7.2 Write property test for basis selection
    - **Property 11: Timetable basis selection honors mode and snapshot**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.5, 7.6, 7.7**

- [x] 8. Checkpoint - Ensure all pure-layer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement the service reader layer
  - [x] 9.1 Implement `src/services/allocation/allocationReader.ts`
    - Read `Profile` (examTrack, language, subscriptionTier), all + pending `Chapter`s, the user's `PYQAttempt` rows (parse `perQuestion` JSON into `AttemptQuestionOutcome[]`, defensively), `QuestionTopicMap` entries for the referenced questions, and active-year `TopicFrequencyReferenceData`
    - Apply `Weightage_Override` precedence (`weightageOverride ?? weightage`) before handing chapters to the pure layer; scope every query by `ctx.user.id`; read-only on existing models
    - _Requirements: 8.2, 9.1, 9.2, 9.4, 10.2_

- [x] 10. Implement signal and most-frequent endpoints
  - [x] 10.1 Implement `signalService.ts` and `GET /api/allocation/signal` route
    - Handler: `withAuth` → resolve active reference year via `resolveActiveReferenceYear(track, TOPIC_FREQUENCY)` (503 `REFERENCE_DATA_UNAVAILABLE` when null) → `assertTierAllowed` → read via reader → compute `combinedWeightageSignal` → return `{ referenceDataYear, chapters: ChapterSignal[] }`
    - Route file: one-liner wrapping the handler with `withAuth` under `src/app/api/allocation/signal/route.ts`
    - _Requirements: 3.6, 3.7, 9.5, 10.1, 12.1_

  - [x] 10.2 Implement `mostFrequentService.ts` and `GET /api/allocation/most-frequent-chapters` route
    - Handler computes signals then applies `mostFrequentChapters`; returns `{ referenceDataYear, chapters }`
    - Route file under `src/app/api/allocation/most-frequent-chapters/route.ts`
    - _Requirements: 4.1, 4.2, 4.6, 10.1_

  - [x]* 10.3 Write property test for frequency outputs carrying component values and year
    - **Property 6: Frequency outputs carry their component values and reference year**
    - **Validates: Requirements 4.2, 3.6**

  - [x]* 10.4 Write unit test for `referenceDataYear` presence in responses
    - Assert both signal and most-frequent responses include the active `Reference_Data_Year`
    - _Requirements: 3.6_

- [x] 11. Implement suggested-allocation endpoint
  - [x] 11.1 Implement `suggestedAllocationService.ts` and `GET /api/allocation/suggested-allocation` route
    - Handler computes shares via `suggestedTimeAllocation`, upserts the per-user `SuggestedAllocationSnapshot` (new model only), returns `{ referenceDataYear, allocations: ChapterAllocationShare[] }`
    - Route file under `src/app/api/allocation/suggested-allocation/route.ts`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.4, 7.1, 8.1, 10.1_

- [x] 12. Implement allocation-mode endpoint
  - [x] 12.1 Implement `modeService.ts` and `GET`/`PUT /api/allocation/mode` route
    - GET reads `AllocationPreference` (unset → treated as PHASE1_DEFAULT); PUT validates the body (422 `VALIDATION_ERROR` when mode is not an enum value) and upserts the preference; both scope by user and call `assertOwnership`
    - Route file under `src/app/api/allocation/mode/route.ts`
    - _Requirements: 7.1, 7.2, 7.6, 10.1, 10.3, 10.4_

  - [x]* 12.2 Write unit tests for mode validation and ownership/non-disclosure
    - Test invalid mode body → 422; reference to a non-owned/non-existent setting → 403 without disclosing existence
    - _Requirements: 10.3, 10.4_

- [x] 13. Validate cross-cutting service properties
  - [x]* 13.1 Write property test for mutation safety
    - **Property 12: Computations never mutate existing records**
    - **Validates: Requirements 1.6, 2.5, 7.5, 8.3, 9.4**

  - [x]* 13.2 Write property test for per-user isolation
    - **Property 13: Outputs are isolated to the requesting User**
    - **Validates: Requirements 10.2, 1.4**

  - [x]* 13.3 Write property test for missing-input handling
    - **Property 14: Missing required inputs yield a missing-input response and no output**
    - **Validates: Requirements 2.4, 3.7, 9.5**

  - [x]* 13.4 Write property test for tier gating defaulting open
    - **Property 15: Tier gating defaults open and blocks only designated outputs**
    - **Validates: Requirements 12.1, 12.4**

  - [x]* 13.5 Write property test for English localization fallback
    - **Property 16: Localized strings fall back to English**
    - **Validates: Requirements 11.2, 11.3**

- [x] 14. Wire allocation service exports
  - [x] 14.1 Create `src/services/allocation/index.ts` barrel
    - Export the reader and all four service handlers for route consumption
    - _Requirements: 9.1_

- [x] 15. Integrate the suggestion into timetable generation
  - [x] 15.1 Augment `timetableGenerationService.ts` with allocation basis
    - After loading pending chapters, read the user's `AllocationPreference.mode` and latest `SuggestedAllocationSnapshot`, pass both through `resolveTimetableBasis(...)` to produce the `AllocatorChapter[]` fed to `allocateStudyHours`; leave all downstream Phase 1 behavior and persisted `Chapter.weightage` untouched
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.1, 8.3_

  - [x]* 15.2 Write integration test preserving Phase 1 scheduling behaviors
    - With mode SUGGESTED, assert Fixed_Commitment avoidance, non-overlap, energy-based slotting, and Buffer_Slot reservation are preserved; persisted weightage unchanged
    - _Requirements: 7.4, 7.5_

  - [x]* 15.3 Write unit test for override-clear resumption
    - Clearing a Time_Allocation_Override / Weightage_Override resumes the suggestion (or weightage fallback) on the next generation
    - _Requirements: 8.4_

- [x] 16. Validate route authentication
  - [x]* 16.1 Write integration test for unauthenticated rejection
    - Assert each `/api/allocation/*` route returns 401 `UNAUTHORIZED` without a valid session and includes no allocation/user data
    - _Requirements: 10.1_

- [x] 17. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific granular requirements for traceability.
- Property tests use fast-check with Vitest, run a minimum of 100 iterations, and are tagged with `Feature: weightage-based-time-allocation, Property {number}: ...`.
- The pure `src/lib/allocation/*` modules are the property-test surface; service-level properties cover isolation, mutation safety, missing-input, gating, and localization.
- Checkpoints ensure incremental validation at the pure-layer boundary and at completion.
- The feature is additive and reuse-only: no existing Phase 1 / Performance Analytics model, column, value, or behavior is changed.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.3", "3.1", "4.1", "7.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "3.2", "3.3", "4.2", "4.3", "5.1", "7.2"] },
    { "id": 2, "tasks": ["1.3", "5.2", "6.1"] },
    { "id": 3, "tasks": ["6.2", "6.3", "6.4", "6.5", "9.1"] },
    { "id": 4, "tasks": ["10.1", "10.2", "11.1", "12.1"] },
    { "id": 5, "tasks": ["10.3", "10.4", "12.2", "14.1", "15.1"] },
    { "id": 6, "tasks": ["13.1", "13.2", "13.3", "13.4", "13.5", "15.2", "15.3", "16.1"] }
  ]
}
```
