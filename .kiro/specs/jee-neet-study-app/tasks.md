# Implementation Plan: JEE/NEET Study Companion (Phase 1 MVP)

## Overview

This plan converts the Phase 1 design into incremental, code-only steps for a TypeScript stack: a server-side-only **Next.js API-routes** backend with **PostgreSQL via Prisma**, **Redis + BullMQ** workers, **fast-check** for property-based tests, and a **React Native (Expo)** mobile client. Work proceeds backend-first (scaffold → schema → auth → reference data → onboarding → chapters), then the timetable engine and its sub-algorithms, then activity/progress/audit features, PYQ practice and the extraction worker, timed papers, mistake journal, AI notes + monetization, NTA ingestion + feed, offline sync, localization, and finally the Expo client screens wiring each feature.

Each of the 47 Correctness Properties is implemented as a single fast-check property test (minimum 100 iterations), tagged `// Feature: jee-neet-study-app, Property N: ...`, placed next to the logic it validates. Unit, integration, and worker tests from the design's Testing Strategy are tied to their feature tasks. Test sub-tasks are marked optional with `*`; core implementation tasks are never optional.

Scope is strictly Phase 1 (Requirements 1–21). Phase 2/3 features and the AI Daily Briefing north-star are out of scope and are not implemented here. Non-code activities (EAS app-store submission, manual PYQ content sourcing, production deployment) are listed only as optional manual notes at the end, not as coding tasks.

## Tasks

- [x] 1. Project foundation and scaffolding
  - [x] 1.1 Initialize the backend project structure and tooling
    - Create the Next.js API-only service (no web pages), TypeScript config, ESLint/Prettier, and a `vitest`/`jest` + `fast-check` test harness configured for 100+ iteration property runs
    - Establish folder layout for services, workers, lib (auth, scoring, timetable, localization), and tests; add a shared JSON error-envelope helper `{ error: { code, message, details? } }`
    - _Requirements: design "Architecture", "Error Handling"_

  - [x] 1.2 Configure Prisma, PostgreSQL, Redis/BullMQ, and secret handling
    - Add Prisma with a PostgreSQL datasource, the Redis connection, and BullMQ queue registration for `pyq-extraction`, `nta-ingestion`, and `billing-reconcile`
    - Load AI provider key, Razorpay keys, DB URL, and webhook secret from server-side env only (never bundled to client)
    - _Requirements: design "Background-Job Model", "Security Considerations: Transport & Secrets"_

  - [x] 1.3 Author the full Prisma schema and initial migration
    - Define all enums and models from the Data Models section (User, Session, Profile, Subject, Chapter, FixedCommitment, Timetable, StudyBlock, FocusSession, DailyTimeAudit, CalendarEvent, PYQPaper, AnswerKey, PYQ, PYQAttempt, TimedPaperAttempt, MistakeJournalEntry, NoteSummary, AiUsageEvent, NTAAnnouncement, Subscription, Payment, LocalSyncRecord, OfflineDownload)
    - Include the `@@unique([userId, clientId])` constraints and `userId` on all user-owned models for per-user isolation; generate and run the initial migration
    - _Requirements: 1, 2, 4, 5, 6, 7, 8, 9, 12, 14, 15, 16, 18, 19, 20, 21; design "Data Models"_

- [x] 2. Authentication and session foundation (Req 1)
  - [x] 2.1 Implement password hashing and password-policy validation
    - Hash with argon2id (bcrypt acceptable) using a unique salt; expose constant-time verify; implement password-policy checks returning the specific failed requirement
    - _Requirements: 1.3, 1.6_

  - [x] 2.2 Implement register, login, logout, and `/auth/me` endpoints
    - `POST /auth/register` (201 token+user, 409 duplicate email, 422 weak password), `POST /auth/login` (200 token, 401 invalid), `POST /auth/logout` (204), `GET /auth/me` returning `{ user, profileComplete }`; issue high-entropy opaque session tokens stored hashed with expiry
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 2.3 Implement session-validation middleware and per-user isolation guard
    - Reject requests to protected endpoints lacking a valid `Bearer` token with an authorization error; allow only `/auth/register`, `/auth/login`, and signature-verified `/webhooks/razorpay` as unauthenticated; scope every query by authenticated `userId` and return 403 on cross-user access
    - _Requirements: 1.7; design "Authorization & Per-User Isolation"_

  - [x]* 2.4 Property test: registration uniqueness
    - **Property 1: Registration is unique per email**
    - **Validates: Requirements 1.2**

  - [x]* 2.5 Property test: password policy gate
    - **Property 2: Password policy gate**
    - **Validates: Requirements 1.3**

  - [x]* 2.6 Property test: credential authentication round-trip
    - **Property 3: Credential authentication round-trip**
    - **Validates: Requirements 1.4, 1.5**

  - [x]* 2.7 Property test: passwords never stored in plaintext
    - **Property 4: Passwords are never stored in plaintext**
    - **Validates: Requirements 1.6**

  - [x]* 2.8 Unit/integration tests for auth happy path and route guard
    - Register happy path (1.1) and protected-route guard rejecting requests without a token across representative endpoints (1.7)
    - _Requirements: 1.1, 1.7_

- [x] 3. Reference data seeding and service (Req 2.7, 11, 12.6)
  - [x] 3.1 Define and seed track-keyed reference data
    - Seed Subjects per Exam_Track (JEE: Physics/Chemistry/Maths; NEET: Physics/Chemistry/Biology), chapters with Chapter_Weightage, Estimated_Study_Hours, Task_Difficulty (hard/light), and Target_Exam_Date per track/year; write an idempotent seed script
    - _Requirements: 2.4, 2.7, 11.1, 12.6, 13.x reference_

  - [x] 3.2 Implement the Reference Data Service read endpoints
    - `GET /reference/subjects`, `GET /reference/chapters`, `GET /reference/exam-date` keyed by track/year
    - _Requirements: 2.7, 11.1, 12.6, 14.6_

- [x] 4. Onboarding and profile service (Req 2, 10 persistence)
  - [x] 4.1 Implement onboarding endpoint with validation and reference/subject association
    - `POST /onboarding` persists exam track, target year, current class, fixed commitments, and peak focus windows; reject target year < current year and any commitment with end ≤ start (422); on track selection load reference chapters/weightage/est-hours and initialize each Chapter_Status to Not Started; preserve track and continue if subject association fails
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.8, 2.9_

  - [x] 4.2 Implement profile endpoints
    - `GET /profile`, `PATCH /profile/language`, `PATCH /profile/peak-windows`, `POST /profile/fixed-commitments` (422 end ≤ start), `DELETE /profile/fixed-commitments/:id`
    - _Requirements: 2.1, 2.3, 2.8, 10.1_

  - [x]* 4.3 Property test: exam-track subject and reference load
    - **Property 5: Exam-track subject and reference load**
    - **Validates: Requirements 2.4, 2.7, 12.6**

  - [x]* 4.4 Property test: onboarding validation boundaries
    - **Property 6: Onboarding validation boundaries**
    - **Validates: Requirements 2.2, 2.3**

  - [x]* 4.5 Unit test: subject-association failure preserves track
    - Assert track selection is preserved and onboarding continues when subject association fails (2.5)
    - _Requirements: 2.5_

- [x] 5. Chapter and syllabus tracking service (Req 12)
  - [x] 5.1 Implement chapter status lifecycle and transition enforcement
    - `GET /chapters`, `PATCH /chapters/:id/status` accepting only forward transitions along `NOT_STARTED → IN_PROGRESS → DONE → REVISED` (422 on backward/illegal)
    - _Requirements: 12.1, 12.2_

  - [x] 5.2 Implement chapter override endpoints
    - `PATCH /chapters/:id/override` (weightage/estHours/timeAllocation) and `DELETE /chapters/:id/override` to clear; overrides persist on the Chapter row
    - _Requirements: 11.3, 11.4_

  - [x] 5.3 Implement syllabus completion computation
    - `GET /syllabus/completion` = chapters with status Done or Revised / total chapters; report 0% when zero chapters
    - _Requirements: 12.4, 12.5_

  - [x]* 5.4 Property test: syllabus completion percentage
    - **Property 25: Syllabus completion percentage**
    - **Validates: Requirements 12.4, 12.5**

  - [x]* 5.5 Property test: chapter status transition ordering
    - **Property 26: Chapter status transition ordering**
    - **Validates: Requirements 12.1, 12.2**

- [x] 6. Timetable generation engine and editing (Req 3, 11, 12.3, 13, 14.5, 15, 16, 17)
  - [x] 6.1 Implement the free-time grid and calendar-event budget reshaping (algorithm steps 1–2)
    - Build per-day free intervals by subtracting Fixed_Commitments at 30-min granularity; compute weekly study budget from default daily load reshaped by Calendar_Events (Mock_Test removes the date, School_Exam scales down, Holiday scales up)
    - _Requirements: 3.1, 16.3, 16.4, 16.5_

  - [x] 6.2 Implement buffer reservation, weightage allocation, and efficiency scaling (steps 3–5)
    - Reserve 10–15% of weekly hours as Buffer_Slots (subjectId null); allocate assignable time across pending chapters proportional to effective weightage (override → weightage → subject-mean fallback flagged default); cap by remaining estimated hours; when efficiencyScore < 1 scale durations toward actual
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 12.3, 14.5, 15.1_

  - [x] 6.3 Implement difficulty/energy tagging and energy-based slotting (steps 6–7)
    - Classify each slot HIGH if within a Peak_Focus_Window else LOW (all LOW when none set); place HARD tasks in HIGH slots and LIGHT tasks in LOW slots; place a HARD task with no HIGH slot in the next available slot and set `scheduledOutsidePeak`
    - _Requirements: 2.9, 13.1, 13.2, 13.3, 13.4_

  - [x] 6.4 Implement subject interleaving (step 8)
    - Enforce no single subject exceeds 2 consecutive hours without an intervening different-subject block; interleave JEE Physics/Maths/Chemistry and NEET Biology/Physics/Chemistry; skip the constraint when only one subject has pending chapters
    - _Requirements: 17.1, 17.2, 17.3, 17.4_

  - [x] 6.5 Implement generation orchestration, persistence, and read endpoints (step 9)
    - Wire steps 1–8 into `POST /timetable/generate`; persist StudyBlocks + Buffer_Slots guaranteeing no two study blocks overlap and none overlap a fixed commitment; distribute across all subjects with pending chapters; add `GET /timetable`
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 6.6 Implement block edit and delete with atomic overlap validation
    - `PATCH /timetable/blocks/:id` rejects the whole edit with 409 and leaves the original unchanged on any overlap with another study block or fixed commitment, otherwise persists; `DELETE /timetable/blocks/:id` removes the block
    - _Requirements: 3.4, 3.5, 3.6, 3.7_

  - [x] 6.7 Implement calendar-event CRUD and holiday sprint offer
    - Persist Calendar_Events (School_Exam/Holiday/Mock_Test) with date range; reject end before start (422); offer an intensified holiday sprint plan for upcoming holiday ranges
    - _Requirements: 16.1, 16.2, 16.6_

  - [x] 6.8 Implement the adaptive rebalancer and buffer policy
    - `POST /timetable/blocks/:id/missed` reschedules missed work into an available Buffer_Slot before compressing any subject, compresses other subjects only when no buffer fits; `PATCH /timetable/buffer-policy`; convert unused end-of-week buffer to the chosen CATCH_UP/EXTRA_REVISION option
    - _Requirements: 15.2, 15.3, 15.4, 15.5_

  - [x]* 6.9 Property test: no-overlap invariant
    - **Property 8: No-overlap invariant**
    - **Validates: Requirements 3.1, 3.3**

  - [x]* 6.10 Property test: edit accept/reject is overlap-correct and atomic
    - **Property 9: Edit accept/reject is overlap-correct and atomic**
    - **Validates: Requirements 3.4, 3.5, 3.6**

  - [x]* 6.11 Property test: multi-subject distribution
    - **Property 10: Multi-subject distribution**
    - **Validates: Requirements 3.2, 17.2, 17.3**

  - [x]* 6.12 Property test: only pending chapters are scheduled
    - **Property 11: Only pending chapters are scheduled**
    - **Validates: Requirements 12.3**

  - [x]* 6.13 Property test: weightage-proportional allocation
    - **Property 12: Weightage-proportional allocation**
    - **Validates: Requirements 11.1, 11.2**

  - [x]* 6.14 Property test: overrides applied and retained
    - **Property 13: Overrides applied and retained**
    - **Validates: Requirements 11.3, 11.4**

  - [x]* 6.15 Property test: missing-weightage fallback
    - **Property 14: Missing-weightage fallback**
    - **Validates: Requirements 11.5**

  - [x]* 6.16 Property test: energy classification and matching
    - **Property 15: Energy classification and matching**
    - **Validates: Requirements 2.9, 13.1, 13.2, 13.3, 13.4**

  - [x]* 6.17 Property test: interleaving bound
    - **Property 16: Interleaving bound**
    - **Validates: Requirements 17.1, 17.4**

  - [x]* 6.18 Property test: buffer reservation bound
    - **Property 17: Buffer reservation bound**
    - **Validates: Requirements 15.1**

  - [x]* 6.19 Property test: rebalancer prefers buffers before compressing
    - **Property 18: Rebalancer prefers buffers before compressing**
    - **Validates: Requirements 15.2, 15.3**

  - [x]* 6.20 Property test: unused buffer conversion
    - **Property 19: Unused buffer conversion**
    - **Validates: Requirements 15.4, 15.5**

  - [x]* 6.21 Property test: calendar-event load reshaping
    - **Property 20: Calendar-event load reshaping**
    - **Validates: Requirements 16.2, 16.3, 16.4, 16.5**

  - [x]* 6.22 Property test: efficiency under-scaling
    - **Property 29: Efficiency under-scaling**
    - **Validates: Requirements 14.5**

  - [x]* 6.23 Unit tests for timetable specifics
    - Delete-block removal (3.7), holiday sprint offer (16.6), and exact track interleaving sets JEE Physics/Maths/Chemistry and NEET Biology/Physics/Chemistry (17.2/17.3)
    - _Requirements: 3.7, 16.6, 17.2, 17.3_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Focus timer / session service (Req 4)
  - [x] 8.1 Implement focus-session record endpoint with validation and default session type
    - `POST /focus-sessions` validating focusedDuration > 0 and ≤ wall-clock span (422 otherwise), requiring a subject, persisting subject/start/end/duration; default Session_Type to NEW_CHAPTER when omitted; accept optional `clientId`
    - _Requirements: 4.3, 4.5, 4.7, 4.8_

  - [x] 8.2 Implement focus-session list endpoint
    - `GET /focus-sessions?from=&to=` scoped to the user
    - _Requirements: 4.3_

  - [x]* 8.3 Property test: focus-session duration validity
    - **Property 21: Focus-session duration validity**
    - **Validates: Requirements 4.5**

  - [x]* 8.4 Property test: session-type default
    - **Property 22: Session-type default**
    - **Validates: Requirements 4.7, 4.8**

- [x] 9. Progress dashboard service (Req 5, 12.4)
  - [x] 9.1 Implement the dashboard endpoint
    - `GET /dashboard` returning per-subject focused time for current day and week (each session under exactly one subject), streak (N consecutive days with ≥1 session ending today, zero when none today), and syllabus completion percent
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 12.4_

  - [x]* 9.2 Property test: per-subject study-time aggregation
    - **Property 23: Per-subject study-time aggregation**
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [x]* 9.3 Property test: streak computation
    - **Property 24: Streak computation**
    - **Validates: Requirements 5.4, 5.5**

- [x] 10. Daily time audit and study velocity service (Req 14)
  - [x] 10.1 Implement the daily audit endpoint
    - `POST /audits/daily` recording planned vs actual; derive actual from that day's focus sessions when present, else use the user-entered value
    - _Requirements: 14.1, 14.2, 14.3_

  - [x] 10.2 Implement efficiency score and velocity projection endpoints
    - `GET /audits/efficiency` (Σ actual / Σ planned); `GET /velocity` computing Target_Completion_Date = Target_Exam_Date − Revision_Buffer and projecting completion from remaining estimated hours and recent rate, reporting AHEAD/BEHIND and whole-day delta
    - _Requirements: 14.4, 14.6, 14.7, 14.8_

  - [x]* 10.3 Property test: daily-audit actual-time derivation
    - **Property 27: Daily-audit actual-time derivation**
    - **Validates: Requirements 14.1, 14.2, 14.3**

  - [x]* 10.4 Property test: efficiency score equals ratio
    - **Property 28: Efficiency score equals ratio**
    - **Validates: Requirements 14.4**

  - [x]* 10.5 Property test: target completion and velocity projection
    - **Property 30: Target completion and velocity projection**
    - **Validates: Requirements 14.6, 14.7, 14.8**

- [x] 11. PYQ practice and scoring service (Req 6)
  - [x] 11.1 Implement the pure scoring function for PYQ and timed papers
    - Pure `(answers, answerKey) → { perQuestion, totalScore }`: CORRECT when selected matches key, UNANSWERED when none selected, INCORRECT otherwise; totalScore = count of CORRECT; unanswered always counts as incorrect while labeled UNANSWERED
    - _Requirements: 6.2, 6.3, 6.4_

  - [x] 11.2 Implement filtered PYQ retrieval
    - `GET /pyqs?year=&subjectId=` returning only questions matching year, subject, and the user's exam track, excluding records flagged for review
    - _Requirements: 6.1_

  - [x] 11.3 Implement PYQ attempt submission and persistence
    - `POST /pyq-attempts` scoring via the pure function, persisting attempt with answers/perQuestion/score and optional `clientId`; available to Free tier; `GET /pyq-attempts/:id`
    - _Requirements: 6.5, 6.6_

  - [x]* 11.4 Property test: scoring correctness
    - **Property 31: Scoring correctness (PYQ and Timed Paper)**
    - **Validates: Requirements 6.2, 6.3, 6.4, 19.5, 19.6**

  - [x]* 11.5 Property test: PYQ filtering
    - **Property 32: PYQ filtering**
    - **Validates: Requirements 6.1**

  - [x]* 11.6 Property test: core features available to all tiers
    - **Property 33: Core features available to all tiers**
    - **Validates: Requirements 6.6, 9.4**

- [x] 12. PYQ extraction pipeline worker (Req 7)
  - [x] 12.1 Implement the `pyq-extraction` worker
    - Process source page images through the AI vision model into structured PYQ records (text + exactly four options + correct-answer ref); reconcile the stored correct answer to the official Answer_Key; flag records without exactly four options for manual review and exclude them from practice; associate track/year/subject; idempotent on re-running the same source ref
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 12.2 Implement operator job endpoints
    - `POST /admin/pyq-extraction/jobs` and `GET /admin/pyq-extraction/jobs/:id` returning status/produced/flaggedForReview
    - _Requirements: 7.1, 7.3_

  - [x]* 12.3 Property test: extraction reconciliation and option-count gating
    - **Property 34: Extraction reconciliation and option-count gating**
    - **Validates: Requirements 7.2, 7.3, 7.4**

  - [x]* 12.4 Worker tests for extraction pipeline
    - Mock the AI vision call; assert four-options → eligible, otherwise flagged and excluded (7.1/7.3), key reconciliation (7.2), track/year/subject association (7.4), and re-run idempotency
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 13. Timed paper mode service (Req 19)
  - [x] 13.1 Implement paper retrieval and timed attempt submission
    - `GET /papers/:id` returning standard duration and questions; `POST /timed-attempts` scoring every question of the paper at submission via the shared scoring function (unanswered counted incorrect), persisting Timed_Paper_Attempt with perQuestion/score/timeTaken and optional `clientId`, marking incorrect questions journal-eligible; `GET /timed-attempts/:id`
    - _Requirements: 19.5, 19.6, 19.7, 19.8_

  - [x]* 13.2 Property test: incorrect timed-paper questions are journal-eligible
    - **Property 38: Incorrect timed-paper questions are journal-eligible**
    - **Validates: Requirements 19.8**

- [x] 14. Mistake journal service (Req 18)
  - [x] 14.1 Implement mistake flag upsert, validation, and filtering
    - `POST /mistakes` upserting on `(userId, questionId)` (update not duplicate), rejecting missing category (422) and rejecting flagging a correctly-answered, unflagged question (422), storing question ref, submitted answer, correct answer, category, optional note; `GET /mistakes?subjectId=&category=` filtered; `DELETE /mistakes/:id`
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7_

  - [x]* 14.2 Property test: mistake-journal flag validity
    - **Property 35: Mistake-journal flag validity**
    - **Validates: Requirements 18.1, 18.2, 18.3**

  - [x]* 14.3 Property test: mistake-journal upsert idempotency
    - **Property 36: Mistake-journal upsert idempotency**
    - **Validates: Requirements 18.4**

  - [x]* 14.4 Property test: mistake-journal filtering
    - **Property 37: Mistake-journal filtering**
    - **Validates: Requirements 18.5, 18.6**

- [x] 15. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. AI notes service and monetization (Req 8, 9)
  - [x] 16.1 Implement the AI notes service with tier/quota gating and usage accounting
    - `POST /ai/summaries` in the exact order: free-tier → 402 with no usage; paid quota 0 → 429 with no usage; empty/whitespace input → 422 recording exactly one usage and no quota decrement; valid → call vision/text model, persist Note_Summary, record exactly one usage and decrement quota by one; `GET /ai/summaries`; grant all tiers access to core features
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.1, 9.2, 9.3, 9.4_

  - [x] 16.2 Implement subscription order/verify and the `billing-reconcile` worker
    - `POST /subscriptions/order` (Razorpay order), `POST /subscriptions/verify` (verify signature), `GET /subscriptions`; run the upgrade as a transaction setting tier=PAID + allocating quota; on upgrade failure after capture, refund via Razorpay and leave tier unchanged, executed in the retryable `billing-reconcile` worker
    - _Requirements: 9.5, 9.6_

  - [x] 16.3 Implement the Razorpay webhook with signature verification
    - `POST /webhooks/razorpay` verifying the `X-Razorpay-Signature` HMAC before acting; reject unverified payloads with 400; act only on signature-verified events
    - _Requirements: 9.5; design "Razorpay Webhook Verification"_

  - [x]* 16.4 Property test: empty-input rejection
    - **Property 39: Empty-input rejection**
    - **Validates: Requirements 8.3**

  - [x]* 16.5 Property test: exactly one usage unit per AI attempt
    - **Property 40: Exactly one usage unit per AI attempt**
    - **Validates: Requirements 8.4, 8.5**

  - [x]* 16.6 Property test: free-tier rejection records no usage
    - **Property 41: Free-tier rejection records no usage**
    - **Validates: Requirements 9.1**

  - [x]* 16.7 Property test: quota-exceeded rejection
    - **Property 42: Quota-exceeded rejection**
    - **Validates: Requirements 9.2**

  - [x]* 16.8 Property test: quota decrements by exactly one on acceptance
    - **Property 43: Quota decrements by exactly one on acceptance**
    - **Validates: Requirements 9.3**

  - [x]* 16.9 Integration tests for AI and billing flows
    - Text (8.1) and photo/vision (8.2) success paths with mocked structured response persisting summary (8.6); payment order→verify→tier grant+quota (9.5) and failure→refund+unchanged tier (9.6) with Razorpay and webhook signature mocked
    - _Requirements: 8.1, 8.2, 8.6, 9.5, 9.6_

- [x] 17. NTA ingestion worker and update feed (Req 20)
  - [x] 17.1 Implement the `nta-ingestion` worker
    - Repeatable BullMQ job that fetches announcements for JEE Main/JEE Advanced/NEET, validates and sanitizes content before storage, skips malformed/unparseable items, computes a `dedupeHash` to de-duplicate, and on exam-date changes updates affected users' Target_Exam_Date and recomputes Target_Completion_Date and countdown
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.6_

  - [x] 17.2 Implement the NTA feed read endpoint
    - `GET /nta/feed` returning stored announcements in chronological order filtered to the user's exam track
    - _Requirements: 20.5_

  - [x]* 17.3 Property test: ingestion sanitizes, skips malformed, de-duplicates
    - **Property 44: Ingestion sanitizes, skips malformed, and de-duplicates**
    - **Validates: Requirements 20.2, 20.3, 20.4**

  - [x]* 17.4 Property test: feed ordering and track filtering
    - **Property 45: Feed ordering and track filtering**
    - **Validates: Requirements 20.5**

  - [x]* 17.5 Property test: exam-date change propagation
    - **Property 46: Exam-date change propagation**
    - **Validates: Requirements 20.6**

- [x] 18. Offline sync handler (Req 21 server side)
  - [x] 18.1 Implement paper-bundle download and idempotent sync endpoints
    - `GET /offline/papers/:id/bundle` returning paper + answer key; `POST /sync` idempotently upserting Focus_Session / PYQ_Attempt / Timed_Paper_Attempt keyed by `(userId, clientId)` inside a transaction, returning canonical server ids and computed scores with status CREATED/DUPLICATE
    - _Requirements: 21.1, 21.5_

  - [x]* 18.2 Property test: idempotent offline sync
    - **Property 47: Idempotent offline sync**
    - **Validates: Requirements 21.5**

- [x] 19. Localization support (Req 10)
  - [x] 19.1 Implement the localized string catalog and resolver
    - Ship an EN/HI string catalog in the client-shared layer; implement a resolver that returns the string for the selected Language_Preference and falls back to the English string when a key is missing; support EN and HI as the only values
    - _Requirements: 10.2, 10.3, 10.4_

  - [x]* 19.2 Property test: language preference round-trip with English fallback
    - **Property 7: Language preference round-trip with English fallback**
    - **Validates: Requirements 10.1, 10.3, 10.4**

- [x] 20. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 21. React Native (Expo) mobile client
  - [x] 21.1 Scaffold the Expo app, navigation, API client, and onboarding gating
    - Set up Expo + navigation, a typed API client with session-token storage, and routing that presents the onboarding flow before the main app for authenticated users who have not completed onboarding
    - _Requirements: 2.6_

  - [x] 21.2 Implement auth and onboarding screens
    - Registration/login screens wired to auth endpoints; onboarding screens for exam track, target year, class, fixed commitments, and peak focus windows wired to `/onboarding`
    - _Requirements: 1.1, 1.4, 2.1, 2.2, 2.3, 2.6, 2.8, 2.9_

  - [x] 21.3 Implement timetable view and edit screens
    - Render generated timetable with buffer slots; edit/delete blocks surfacing 409 conflicts; calendar-event marking and missed-block rebalance/buffer-policy controls
    - _Requirements: 3.1, 3.4, 3.5, 3.7, 15.4, 16.1, 16.6_

  - [x] 21.4 Implement the focus timer screen
    - Pomodoro-style local timing that excludes paused time from focused duration, requires subject selection before start, allows Session_Type tagging, and records via `/focus-sessions`
    - _Requirements: 4.1, 4.2, 4.4, 4.6_

  - [x] 21.5 Implement progress dashboard, chapter status, and audit/velocity screens
    - Per-subject hours, streak, syllabus completion; chapter status updates; daily check-in and velocity AHEAD/BEHIND display wired to dashboard/chapters/audits/velocity endpoints
    - _Requirements: 5.1, 5.4, 12.1, 12.4, 14.1, 14.8_

  - [x] 21.6 Implement PYQ practice, timed paper, and mistake journal screens
    - PYQ filter/practice with instant scoring; Timed Paper Mode with running countdown, editable answer sheet, auto-submit at zero and manual submit; flagging incorrect/flagged questions into the categorized mistake journal with filters
    - _Requirements: 6.1, 6.2, 19.1, 19.2, 19.3, 19.4, 18.1, 18.5, 18.6_

  - [x] 21.7 Implement AI notes and subscription/paywall screens
    - Note text and photo summarization wired to `/ai/summaries` showing remaining quota; upgrade/paywall flow wired to subscription order/verify
    - _Requirements: 8.1, 8.2, 9.1, 9.5_

  - [x] 21.8 Implement NTA feed screen and localization wiring
    - Render the track-filtered chronological NTA feed; apply the stored Language_Preference over device locale across rendered text using the catalog resolver
    - _Requirements: 20.5, 10.2_

  - [x] 21.9 Implement read-only offline mode
    - Local SQLite/expo-file-system store for Offline_Downloads; serve downloaded papers and run the focus timer offline; queue Focus_Sessions/PYQ/Timed answers as Local_Sync_Records keyed by client UUID; sync the outbox on reconnect; indicate AI summarizer and NTA feed are unavailable offline
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.6_

  - [x]* 21.10 Client unit tests
    - Localized rendering honoring stored preference over device locale (10.2); focus timer pause excludes elapsed time from focused duration (4.2)
    - _Requirements: 10.2, 4.2_

- [x] 22. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each of Properties 1–47 is a single fast-check property test running a minimum of 100 iterations, tagged `// Feature: jee-neet-study-app, Property N: ...`, placed beside the logic it validates.
- All 21 requirements are covered: Req 1 (Epic 2), Req 2 (Epics 3–4), Req 3/11/12.3/13/15/16/17 (Epic 6 + Epic 5 for Req 12), Req 4 (Epic 8), Req 5 (Epic 9), Req 14 (Epic 10), Req 6 (Epic 11), Req 7 (Epic 12), Req 19 (Epic 13), Req 18 (Epic 14), Req 8/9 (Epic 16), Req 20 (Epic 17), Req 21 (Epic 18), Req 10 (Epics 4/19), and client wiring (Epic 21).
- Checkpoints (Epics 7, 15, 20, 22) provide incremental validation points.
- **Out of scope (not coding tasks):** EAS Build/Submit and app-store submission, production/staging deployment, manual sourcing/operator review of PYQ PDFs and answer keys, and live NTA source onboarding. These are operational/manual activities; the worker and operator endpoints to support them are implemented (Epics 12, 17), but performing the manual content/deploy steps is not a coding task.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["2.1", "3.1", "11.1", "19.1"] },
    { "id": 4, "tasks": ["2.2", "2.3", "3.2", "19.2"] },
    { "id": 5, "tasks": ["2.4", "2.5", "2.6", "2.7", "2.8", "4.1", "11.2"] },
    { "id": 6, "tasks": ["4.2", "5.1", "5.2", "11.3", "12.1", "13.1", "16.1", "17.1", "18.1"] },
    { "id": 7, "tasks": ["4.3", "4.4", "4.5", "5.3", "8.1", "11.4", "11.5", "11.6", "12.2", "14.1", "16.2", "16.3", "17.2"] },
    { "id": 8, "tasks": ["5.4", "5.5", "6.1", "8.2", "9.1", "10.1", "12.3", "12.4", "13.2", "14.2", "14.3", "14.4", "16.4", "16.5", "16.6", "16.7", "16.8", "17.3", "17.4", "17.5", "18.2"] },
    { "id": 9, "tasks": ["6.2", "8.3", "8.4", "9.2", "9.3", "10.2", "16.9"] },
    { "id": 10, "tasks": ["6.3", "10.3", "10.4", "10.5"] },
    { "id": 11, "tasks": ["6.4"] },
    { "id": 12, "tasks": ["6.5", "6.7"] },
    { "id": 13, "tasks": ["6.6", "6.8"] },
    { "id": 14, "tasks": ["6.9", "6.10", "6.11", "6.12", "6.13", "6.14", "6.15", "6.16", "6.17", "6.18", "6.19", "6.20", "6.21", "6.22", "6.23"] },
    { "id": 15, "tasks": ["21.1"] },
    { "id": 16, "tasks": ["21.2", "21.3", "21.4", "21.5", "21.6", "21.7", "21.8", "21.9"] },
    { "id": 17, "tasks": ["21.10"] }
  ]
}
```
