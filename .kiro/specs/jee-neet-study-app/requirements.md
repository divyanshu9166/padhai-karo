# Requirements Document

## Introduction

The JEE/NEET Study Companion is a mobile application that helps JEE and NEET aspirants organize their study, practice past exam questions, and summarize their own notes with AI. The product differentiator is the productivity and organization layer (timetable, focus timer, progress tracking) combined with AI-powered summarization of the student's own study material and practice against public Previous Year Questions (PYQs).

This document specifies the Phase 1 MVP scope: user accounts and authentication, onboarding, a timetable generator, a focus timer, a progress dashboard, PYQ practice with official-answer-key scoring, an AI notes summarizer (text and photo input), monetization gating for the AI tier, and a foundation for bilingual (Hindi + English) support. Phase 2 features and the explicitly out-of-scope items are recorded as non-goals.

A central principle of this MVP is that the Timetable is a living document that responds to the User's actual study behavior rather than a one-time generated artifact. To support this, Phase 1 adds timetable-intelligence capabilities: weightage-aware time allocation seeded from exam reference data, chapter-level time estimation with a syllabus completion tracker, energy-based slot assignment around the User's peak focus hours, a daily planned-versus-actual time audit that feeds an efficiency score and study-velocity projection, auto-protected buffer slots used by an adaptive rebalancer when sessions are missed, a holiday/school-exam mode that reshapes study load around the User's real calendar, and subject interleaving that prevents long single-subject blocks. Phase 1 also captures a Session_Type tag on every Focus_Session as a data foundation, while deferring the per-type analytics surface to Phase 2.

Phase 1 further adds resilience and practice-depth capabilities so the app supports the full study loop and remains useful under real-world conditions: a Mistake Journal (digital error book) that turns wrong PYQ answers into categorized revision material, a Timed Paper Mode for simplified full-paper practice with a running countdown and end-of-session auto-scoring, an NTA Update Feed that ingests official exam announcements and keeps the User's exam dates current, and a read-only Offline Mode for viewing downloaded PYQs and running the Focus Timer without connectivity. The long-term north-star, explicitly a future vision and not Phase 1 scope, is a single personalized AI Daily Briefing that synthesizes all collected signals (timetable, PYQ and mock performance, chapter completion, mistake journal, velocity, and later mood data) into one concise daily message; Phase 1 data models are designed so their signals can later feed this briefing.

## Glossary

- **System**: The complete JEE/NEET Study Companion application, comprising the mobile client and backend API.
- **Mobile_Client**: The React Native (Expo) application running on the user's device.
- **Backend_API**: The server-side API that handles authentication, data persistence, scoring, and AI orchestration.
- **User**: A registered student using the application.
- **Account**: The authenticated identity of a User, including credentials and profile data.
- **Exam_Track**: The exam a User is preparing for, either JEE or NEET.
- **Subject**: A study subject associated with an Exam_Track (e.g., Physics, Chemistry, Mathematics for JEE; Physics, Chemistry, Biology for NEET).
- **Fixed_Commitment**: A recurring time block during which the User is unavailable for study (school hours, coaching hours, sleep schedule).
- **Timetable**: A generated weekly schedule of study blocks across Subjects, derived from Fixed_Commitments.
- **Study_Block**: A single scheduled study slot in the Timetable, associated with a Subject, a start time, and a duration.
- **Focus_Session**: A timed study period tagged to a Subject, recorded with start time, end time, and elapsed focused duration.
- **Streak**: The count of consecutive days on which the User completed at least one Focus_Session.
- **Progress_Dashboard**: The summary view of study hours per Subject and the current Streak.
- **PYQ**: A Previous Year Question from an official JEE Main or NEET paper, including question text, four options, and the official correct answer.
- **PYQ_Paper**: A set of PYQs corresponding to a specific exam, year, and (where applicable) session/shift.
- **Answer_Key**: The official final answer key published by the exam authority, used to determine correct answers for scoring.
- **PYQ_Attempt**: A User's recorded set of answers to a selected set of PYQs, with a computed score.
- **Note_Summary**: The AI-generated structured summary produced from User-supplied note text or a note photo.
- **AI_Notes_Service**: The Backend_API component that orchestrates summarization requests to the vision/text language model.
- **Subscription_Tier**: The User's access level, either Free or Paid.
- **AI_Quota**: The allowance of AI summarization usage available to a User within a billing period or via credits.
- **Language_Preference**: The User's selected interface language, either English or Hindi.
- **Chapter**: A named unit of study within a Subject (e.g., Rotational Dynamics within Physics, GOC within Organic Chemistry).
- **Reference_Data**: Pre-loaded, system-supplied data keyed by Exam_Track that lists each Subject's Chapters together with their Chapter_Weightage and Estimated_Study_Hours.
- **Chapter_Weightage**: The Reference_Data measure of a Chapter's relative contribution to the Exam_Track's marks, used to bias time allocation (e.g., in JEE, Calculus, Mechanics, and Organic Chemistry carry high weightage; in NEET, Biology accounts for approximately 50% of the paper).
- **Estimated_Study_Hours**: The Reference_Data estimate of the hours required to complete a Chapter (e.g., Rotational Dynamics approximately 10 hours, Organic Chemistry GOC approximately 8 hours).
- **Chapter_Status**: The User's progress state for a Chapter, one of Not Started, In Progress, Done, or Revised.
- **Syllabus_Completion**: The percentage of the User's Chapters across all Subjects whose Chapter_Status is Done or Revised.
- **Peak_Focus_Window**: A time-of-day band the User marks as a highest-energy study period, one of morning, afternoon, or night.
- **Energy_Level**: The classification of a Study_Block's time slot as high-energy when it falls within a Peak_Focus_Window and low-energy otherwise.
- **Task_Difficulty**: The Reference_Data classification of a study task as hard (e.g., Mathematics problem solving, Physics numericals) or light (e.g., formula revision, Biology factual reading).
- **Buffer_Slot**: A protected Study_Block reserved as unassigned catch-up time, not allocated to any Subject.
- **Adaptive_Rebalancer**: The Backend_API component that redistributes Study_Blocks when sessions are missed or the plan otherwise changes.
- **Calendar_Event**: A User-marked dated event affecting study scheduling, of type School_Exam, Holiday, or Mock_Test.
- **School_Exam**: A Calendar_Event marking a period of the User's school examinations.
- **Holiday**: A Calendar_Event marking a vacation or holiday period.
- **Mock_Test**: A Calendar_Event marking a coaching mock test day.
- **Session_Type**: The category of a Focus_Session, one of New Chapter, Practice Problems, Revision, Mock Analysis, or Formula Drill.
- **Daily_Time_Audit**: The end-of-day record of the User's planned study time versus actual study time for a given day.
- **Efficiency_Score**: The ratio of total actual study time to total planned study time computed across the User's Daily_Time_Audit history.
- **Study_Velocity**: The User's recent rate of syllabus completion, used to project a syllabus completion date from the remaining Estimated_Study_Hours.
- **Target_Exam_Date**: The Reference_Data exam date for the User's Exam_Track and target attempt year.
- **Revision_Buffer**: The number of days before the Target_Exam_Date reserved for revision rounds, defaulting to 45 days to allow two revision rounds.
- **Target_Completion_Date**: The Target_Exam_Date minus the Revision_Buffer, by which the syllabus is intended to be complete.
- **Mistake_Journal**: The User-scoped collection of Mistake_Journal_Entries, retrievable as revision material and filterable by Subject and Mistake_Category.
- **Mistake_Journal_Entry**: A single record flagged from an incorrectly answered or User-flagged question, storing the question reference, the User's submitted wrong answer, the correct answer, the Mistake_Category, and an optional free-text note on why the question was answered incorrectly.
- **Mistake_Category**: The classification of a Mistake_Journal_Entry, one of Silly Mistake, Concept Gap, Time Pressure, or Never Seen This.
- **Timed_Paper_Attempt**: The persisted result of a Timed Paper Mode session over a PYQ_Paper, recording the score, the per-question outcome (correct, incorrect, or unanswered), and the time taken.
- **NTA_Announcement**: A single official announcement ingested from a National Testing Agency (NTA) source for JEE Main, JEE Advanced, or NEET, such as an exam date change, admit card release, or provisional/final answer key release.
- **NTA_Update_Feed**: The chronological in-app feed of NTA_Announcements presented to the User, filtered to the User's Exam_Track.
- **Offline_Download**: A PYQ_Paper together with its Answer_Key stored on the device for read-only use while offline.
- **Local_Sync_Record**: A Focus_Session, PYQ_Attempt, or Timed_Paper_Attempt captured on the device while offline and queued for synchronization to the Backend_API, keyed by a client-generated identifier to enable idempotent sync.
- **AI_Daily_Briefing**: The deferred north-star feature that synthesizes the User's collected signals (timetable, mistake journal, PYQ and mock performance, chapter completion, study velocity, and later mood data) into a single concise daily message; documented to guide Phase 1 data modeling but not implemented in Phase 1.

## Requirements

### Requirement 1: User Account and Authentication

**User Story:** As an aspirant, I want to create an account and sign in securely, so that my study data is saved and available across sessions.

#### Acceptance Criteria

1. WHEN a User submits a registration request with a valid email and a password meeting the password policy, THE Backend_API SHALL create an Account and return an authenticated session.
2. IF a User submits a registration request with an email already associated with an existing Account, THEN THE Backend_API SHALL reject the request and return a conflict error.
3. IF a User submits a registration request with a password that does not meet the password policy, THEN THE Backend_API SHALL reject the request and return a validation error identifying the password requirement.
4. WHEN a User submits sign-in credentials that match an existing Account, THE Backend_API SHALL return an authenticated session token.
5. IF a User submits sign-in credentials that do not match any existing Account, THEN THE Backend_API SHALL reject the request and return an authentication error.
6. THE Backend_API SHALL store User passwords using a one-way salted hash.
7. WHEN a request to a protected endpoint is received without a valid session token, THE Backend_API SHALL reject the request and return an authorization error.

### Requirement 2: Onboarding

**User Story:** As a new User, I want to provide my exam, target year, class, and fixed commitments during onboarding, so that the app can tailor my study plan.

#### Acceptance Criteria

1. WHEN a User completes onboarding with an Exam_Track, a target attempt year, a current class, and a set of Fixed_Commitments, THE Backend_API SHALL persist these values to the User profile.
2. IF a User submits an onboarding target attempt year earlier than the current calendar year, THEN THE Backend_API SHALL reject the value and return a validation error.
3. IF a User submits a Fixed_Commitment whose end time is not later than its start time, THEN THE Backend_API SHALL reject the Fixed_Commitment and return a validation error.
4. WHEN a User selects an Exam_Track, THE System SHALL associate the Subject set corresponding to that Exam_Track with the User profile.
5. IF Subject association fails when a User selects an Exam_Track, THEN THE System SHALL preserve the Exam_Track selection and allow the User to continue onboarding.
6. WHEN an authenticated User who has not completed onboarding opens the Mobile_Client, THE Mobile_Client SHALL present the onboarding flow before the main application.
7. WHEN a User selects an Exam_Track during onboarding, THE System SHALL load the Reference_Data Chapters, Chapter_Weightage values, and Estimated_Study_Hours for that Exam_Track into the User profile and initialize each Chapter_Status to Not Started.
8. WHEN a User marks one or more Peak_Focus_Windows during onboarding, THE Backend_API SHALL persist the selected Peak_Focus_Windows to the User profile.
9. IF a User completes onboarding without marking any Peak_Focus_Window, THEN THE Backend_API SHALL treat every time slot as low-energy for that User.

### Requirement 3: Timetable Generator

**User Story:** As a User, I want the app to auto-generate an editable weekly study timetable from my fixed commitments, so that I have a structured plan without building it manually.

#### Acceptance Criteria

1. WHEN a User requests timetable generation, THE Backend_API SHALL produce a Timetable of Study_Blocks that occupy only time ranges not overlapping any Fixed_Commitment.
2. THE Backend_API SHALL distribute Study_Blocks across all Subjects associated with the User's Exam_Track.
3. WHEN a Timetable is generated, THE Backend_API SHALL ensure that no two Study_Blocks in the Timetable overlap in time.
4. WHEN a User edits a Study_Block start time, duration, or Subject, THE Backend_API SHALL persist the edited Study_Block.
5. IF a User edits a Study_Block so that it overlaps an existing Study_Block or a Fixed_Commitment, THEN THE Backend_API SHALL reject the entire edit, leave the original Study_Block unchanged, and return a conflict error.
6. WHILE a User's edit produces no overlap with any existing Study_Block or Fixed_Commitment, THE Backend_API SHALL accept the edit without returning a conflict error.
7. WHEN a User deletes a Study_Block, THE Backend_API SHALL remove the Study_Block from the Timetable.

### Requirement 4: Focus Timer

**User Story:** As a User, I want a Pomodoro-style focus timer tagged to a subject, so that I can track focused study time per subject.

#### Acceptance Criteria

1. WHEN a User starts a Focus_Session tagged to a Subject, THE Mobile_Client SHALL begin counting elapsed focused time for that Subject.
2. WHILE a Focus_Session is paused, THE Mobile_Client SHALL exclude elapsed time from the session's focused duration.
3. WHEN a User stops a Focus_Session, THE Backend_API SHALL record the Focus_Session with its Subject, start time, end time, and focused duration.
4. IF a User attempts to start a Focus_Session without selecting a Subject, THEN THE Mobile_Client SHALL prevent the start and prompt the User to select a Subject.
5. WHEN a Focus_Session is recorded, THE Backend_API SHALL ensure the recorded focused duration is greater than zero and not greater than the elapsed wall-clock time between start and end.
6. WHEN a User starts or records a Focus_Session, THE Mobile_Client SHALL allow the User to tag the Focus_Session with a Session_Type of New Chapter, Practice Problems, Revision, Mock Analysis, or Formula Drill.
7. WHEN a Focus_Session is recorded, THE Backend_API SHALL persist the Session_Type together with the Focus_Session.
8. IF a User records a Focus_Session without selecting a Session_Type, THEN THE Backend_API SHALL persist the Focus_Session with a Session_Type of New Chapter.

### Requirement 5: Progress Dashboard

**User Story:** As a User, I want to see my study hours per subject and my streak, so that I can monitor my consistency and effort.

#### Acceptance Criteria

1. WHEN a User opens the Progress_Dashboard, THE Backend_API SHALL return the total focused study time per Subject for the current day and the current week.
2. THE Backend_API SHALL compute the per-Subject study time as the sum of focused durations of all Focus_Sessions for that Subject within the requested period.
3. THE Backend_API SHALL associate each Focus_Session with exactly one Subject for the purpose of study-time aggregation.
4. WHEN a User has completed at least one Focus_Session on each of N consecutive days ending today, THE Backend_API SHALL report a Streak of N.
5. IF a User has not completed any Focus_Session on the most recent day required to continue a Streak, THEN THE Backend_API SHALL report a Streak of zero regardless of any previous Streak length.

### Requirement 6: PYQ Practice and Scoring

**User Story:** As a User, I want to practice previous-year questions filtered by year and subject and get instant scoring against the official answer key, so that I can assess my readiness.

#### Acceptance Criteria

1. WHEN a User requests PYQs filtered by year and Subject, THE Backend_API SHALL return only PYQs matching the selected year and Subject for the User's Exam_Track.
2. WHEN a User submits a PYQ_Attempt with selected answers, THE Backend_API SHALL score each answer against the official Answer_Key and return the per-question result as one of correct, answered-incorrectly, or unanswered.
3. THE Backend_API SHALL compute the total score of a PYQ_Attempt as the count of answers matching the Answer_Key.
4. WHERE a question was left unanswered in a PYQ_Attempt, THE Backend_API SHALL score that question as incorrect and label it unanswered, regardless of any other factor.
5. WHEN a PYQ_Attempt is submitted, THE Backend_API SHALL persist the PYQ_Attempt with its answers and computed score for the User.
6. THE Backend_API SHALL make PYQ practice and scoring available to Users of the Free Subscription_Tier.

### Requirement 7: PYQ Extraction Pipeline

**User Story:** As a content operator, I want official PYQ PDFs converted into structured questions validated against the final answer key, so that PYQ practice uses accurate data.

#### Acceptance Criteria

1. WHEN a PYQ source page image is processed by the extraction pipeline, THE Backend_API SHALL produce a structured PYQ record containing the question text, exactly four options, and a correct-answer reference.
2. WHEN an extracted PYQ's correct-answer reference is reconciled against the official final Answer_Key, THE Backend_API SHALL set the stored correct answer to the Answer_Key value.
3. IF an extracted PYQ does not contain exactly four options, THEN THE Backend_API SHALL flag the PYQ record for manual review and exclude the PYQ from practice availability.
4. THE Backend_API SHALL associate each stored PYQ with its Exam_Track, year, and Subject.

### Requirement 8: AI Notes Summarizer

**User Story:** As a User, I want to paste note text or upload a photo of my notes and receive a structured summary, so that I can revise efficiently.

#### Acceptance Criteria

1. WHEN a Paid-tier User submits note text for summarization, THE AI_Notes_Service SHALL return a Note_Summary containing structured key points.
2. WHEN a Paid-tier User submits a note photo for summarization, THE AI_Notes_Service SHALL send the image to a vision-capable model and return a Note_Summary containing structured key points.
3. IF a User submits note text that is empty or contains only whitespace, THEN THE AI_Notes_Service SHALL reject the request and return a validation error.
4. WHEN a Note_Summary is produced, THE Backend_API SHALL record one unit of AI usage against the requesting User's account.
5. WHEN an AI summarization request is rejected for a validation error, THE Backend_API SHALL record one unit of AI usage against the requesting User's account.
6. WHEN an AI summarization request completes, THE Backend_API SHALL persist the resulting Note_Summary associated with the requesting User.

### Requirement 9: Monetization and AI Tier Gating

**User Story:** As a product owner, I want AI notes summarization gated behind a paid tier with a quota, so that the feature is monetized while organization and PYQ features remain free.

#### Acceptance Criteria

1. IF a User of the Free Subscription_Tier requests AI notes summarization, THEN THE Backend_API SHALL reject the request and return an upgrade-required response.
2. IF a Paid-tier User requests AI notes summarization when the remaining AI_Quota is zero, THEN THE Backend_API SHALL reject the request and return a quota-exceeded response.
3. WHEN a Paid-tier User's AI summarization request is accepted, THE Backend_API SHALL decrement the remaining AI_Quota by one unit.
4. THE Backend_API SHALL grant Users of all Subscription_Tiers access to the timetable generator, focus timer, Progress_Dashboard, and PYQ practice.
5. WHEN a User completes a successful subscription payment, THE Backend_API SHALL set the User's Subscription_Tier to Paid and allocate the corresponding AI_Quota.
6. IF the Subscription_Tier upgrade fails after a subscription payment succeeds, THEN THE Backend_API SHALL refund the payment and leave the Subscription_Tier unchanged.

### Requirement 10: Bilingual Support

**User Story:** As a Hindi-preferring aspirant, I want to choose my interface language, so that I can use the app comfortably in Hindi or English.

#### Acceptance Criteria

1. WHEN a User selects a Language_Preference, THE Backend_API SHALL persist the Language_Preference to the User profile.
2. WHEN the Mobile_Client renders interface text, THE Mobile_Client SHALL display the text in the Language_Preference stored on the User profile, overriding any local client language setting, using the localized string catalog.
3. WHERE a localized string is unavailable for the selected Language_Preference, THE Mobile_Client SHALL display the English string for that text.
4. THE System SHALL support English and Hindi as Language_Preference values.

### Requirement 11: Subject Weightage-Aware Scheduling

**User Story:** As a User, I want my timetable to allocate more time to high-weightage chapters, so that I concentrate effort where it earns the most exam marks.

#### Acceptance Criteria

1. WHEN a User requests timetable generation, THE Backend_API SHALL allocate study time across Subjects and Chapters in proportion to their Chapter_Weightage, assigning greater study time to Chapters with higher Chapter_Weightage.
2. THE Backend_API SHALL use Chapter_Weightage-driven allocation as the default time distribution rather than allocating equal time across Subjects and Chapters.
3. WHEN a User overrides the time allocation for a Subject or a Chapter, THE Backend_API SHALL persist the override and apply the override in place of the Chapter_Weightage-driven allocation for that Subject or Chapter.
4. WHILE a User override exists for a Chapter, THE Backend_API SHALL retain the override across subsequent timetable generations until the User clears the override.
5. IF Chapter_Weightage Reference_Data is unavailable for a Chapter, THEN THE Backend_API SHALL allocate that Chapter the mean Chapter_Weightage of its Subject and flag the Chapter as using a default weightage.

### Requirement 12: Chapter-Level Time Estimation and Syllabus Completion Tracking

**User Story:** As a User, I want each chapter to carry an estimated study time and a status, so that the app schedules pending chapters and shows my syllabus completion.

#### Acceptance Criteria

1. WHEN a User updates a Chapter_Status, THE Backend_API SHALL persist the new Chapter_Status as one of Not Started, In Progress, Done, or Revised.
2. THE Backend_API SHALL enforce that a Chapter_Status transitions through the ordered states Not Started, In Progress, Done, and Revised.
3. WHEN a User requests timetable generation, THE Backend_API SHALL allocate Study_Blocks only to Chapters whose Chapter_Status is Not Started or In Progress.
4. WHEN a User opens the Progress_Dashboard, THE Backend_API SHALL return the Syllabus_Completion percentage computed as the count of Chapters with Chapter_Status Done or Revised divided by the total count of the User's Chapters.
5. IF a User has zero Chapters associated, THEN THE Backend_API SHALL report Syllabus_Completion as zero percent.
6. THE Backend_API SHALL associate each Chapter's Estimated_Study_Hours with the Chapter for use in scheduling and Study_Velocity computation.

### Requirement 13: Energy-Based Slot Assignment

**User Story:** As a User, I want demanding subjects scheduled when I am most focused, so that I tackle hard work at peak energy and routine work at low energy.

#### Acceptance Criteria

1. THE Backend_API SHALL classify each Study_Block time slot as high-energy when the slot falls within a Peak_Focus_Window and as low-energy otherwise.
2. WHEN the Backend_API generates a Timetable, THE Backend_API SHALL schedule study tasks whose Task_Difficulty is hard into high-energy slots.
3. WHEN the Backend_API generates a Timetable, THE Backend_API SHALL schedule study tasks whose Task_Difficulty is light into low-energy slots.
4. IF no high-energy slot is available for a hard Task_Difficulty task, THEN THE Backend_API SHALL schedule the task into the next available slot and flag the Study_Block as scheduled outside a Peak_Focus_Window.

### Requirement 14: Daily Time Audit and Study Velocity Tracking

**User Story:** As a User, I want a daily planned-versus-actual check-in and a projection of whether I will finish on time, so that my schedule stays realistic.

#### Acceptance Criteria

1. WHEN a User completes an end-of-day check-in, THE Backend_API SHALL record a Daily_Time_Audit containing the planned study time and the actual study time for that day.
2. WHERE Focus_Session data exists for the day, THE Backend_API SHALL set the Daily_Time_Audit actual study time to the sum of focused durations of that day's Focus_Sessions.
3. WHERE no Focus_Session data exists for the day, THE Backend_API SHALL set the Daily_Time_Audit actual study time to the value entered by the User.
4. THE Backend_API SHALL compute the Efficiency_Score as the ratio of total actual study time to total planned study time across the User's Daily_Time_Audit history.
5. WHILE the User's Efficiency_Score is below one, THE Backend_API SHALL scale future generated Study_Block durations toward the User's actual completed study time.
6. THE Backend_API SHALL compute the Target_Completion_Date as the Target_Exam_Date minus the Revision_Buffer.
7. WHEN a User requests Study_Velocity, THE Backend_API SHALL project a syllabus completion date from the remaining Estimated_Study_Hours of pending Chapters and the User's recent actual study rate.
8. WHEN the Backend_API reports Study_Velocity, THE Backend_API SHALL report whether the projected syllabus completion date is ahead of or behind the Target_Completion_Date and the difference expressed in whole days.

### Requirement 15: Buffer Slots

**User Story:** As a User, I want protected free time in my schedule, so that missed sessions can be recovered without cramming my other subjects.

#### Acceptance Criteria

1. WHEN the Backend_API generates a Timetable, THE Backend_API SHALL reserve between 10 and 15 percent of the weekly study hours as Buffer_Slots that are not assigned to any Subject.
2. WHEN a Study_Block is missed, THE Adaptive_Rebalancer SHALL reschedule the missed Study_Block into an available Buffer_Slot before reducing the time allocated to any other Subject.
3. IF no Buffer_Slot is available for a missed Study_Block, THEN THE Adaptive_Rebalancer SHALL compress other Subjects' Study_Blocks to reschedule the missed Study_Block.
4. THE Backend_API SHALL allow the User to choose whether unused Buffer_Slots convert to catch-up time or extra revision.
5. WHEN a Buffer_Slot remains unused at the end of the week, THE Backend_API SHALL convert the Buffer_Slot to the User's chosen catch-up or extra-revision option.

### Requirement 16: Holiday and School Exam Mode

**User Story:** As a User, I want to mark school exams, holidays, and mock tests, so that my study load adjusts to my real calendar.

#### Acceptance Criteria

1. WHEN a User marks a Calendar_Event with a type of School_Exam, Holiday, or Mock_Test and a date range, THE Backend_API SHALL persist the Calendar_Event.
2. IF a Calendar_Event end date is earlier than its start date, THEN THE Backend_API SHALL reject the Calendar_Event and return a validation error.
3. WHILE a date falls within a School_Exam Calendar_Event, THE Backend_API SHALL reduce the generated daily JEE/NEET study load below the User's default daily study load.
4. WHILE a date falls within a Holiday Calendar_Event, THE Backend_API SHALL increase the generated daily study load above the User's default daily study load.
5. WHEN a date is marked by a Mock_Test Calendar_Event, THE Backend_API SHALL exclude that date from regular Study_Block scheduling.
6. WHERE a Holiday Calendar_Event is upcoming, THE Backend_API SHALL offer an intensified holiday study sprint plan for the Holiday period.

### Requirement 17: Subject Interleaving (Anti-Block Scheduling)

**User Story:** As a User, I want my subjects interleaved rather than scheduled in long blocks, so that I stay engaged and retain more.

#### Acceptance Criteria

1. WHEN the Backend_API generates a Timetable, THE Backend_API SHALL ensure that no single Subject is scheduled for more than 2 consecutive hours without an intervening Study_Block of a different Subject.
2. WHEN the Backend_API generates a Timetable for the JEE Exam_Track, THE Backend_API SHALL interleave Study_Blocks across Physics, Mathematics, and Chemistry.
3. WHEN the Backend_API generates a Timetable for the NEET Exam_Track, THE Backend_API SHALL interleave Study_Blocks across Biology, Physics, and Chemistry.
4. IF only one Subject has pending Chapters, THEN THE Backend_API SHALL schedule that Subject's Study_Blocks without applying the consecutive-hours interleaving constraint.

### Requirement 18: Mistake Journal (Digital Error Book)

**User Story:** As a User, I want to flag the questions I get wrong into a categorized mistake journal, so that I can revise my recurring errors instead of just my scores.

#### Acceptance Criteria

1. WHEN a User flags a question from a completed PYQ_Attempt or Timed_Paper_Attempt into the Mistake_Journal with a Mistake_Category of Silly Mistake, Concept Gap, Time Pressure, or Never Seen This, THE Backend_API SHALL create a Mistake_Journal_Entry storing the question reference, the User's submitted answer, the correct answer, the Mistake_Category, and the optional free-text note.
2. IF a User flags a question into the Mistake_Journal without selecting a Mistake_Category, THEN THE Backend_API SHALL reject the request and return a validation error.
3. IF a User attempts to flag a question that the User answered correctly and did not explicitly flag, THEN THE Backend_API SHALL reject the request and return a validation error.
4. WHEN a User flags a question that already has a Mistake_Journal_Entry for that User, THE Backend_API SHALL update the existing Mistake_Journal_Entry rather than create a duplicate entry.
5. WHEN a User requests the Mistake_Journal filtered by Subject, THE Backend_API SHALL return only the Mistake_Journal_Entries whose question belongs to the selected Subject.
6. WHEN a User requests the Mistake_Journal filtered by Mistake_Category, THE Backend_API SHALL return only the Mistake_Journal_Entries whose Mistake_Category matches the selected Mistake_Category.
7. THE Backend_API SHALL persist each Mistake_Journal_Entry associated with the User.

### Requirement 19: Timed Paper Mode

**User Story:** As a User, I want to attempt a full previous-year paper against a running countdown and get it auto-scored at the end, so that I can practice full-paper pacing without a full mock-test interface.

#### Acceptance Criteria

1. WHEN a User starts a Timed Paper session over a PYQ_Paper, THE Mobile_Client SHALL begin a countdown for the PYQ_Paper's configured standard duration and present a basic answer sheet for recording answers.
2. WHILE a Timed Paper session is in progress, THE Mobile_Client SHALL display the remaining time and allow the User to record or change an answer for any question on the answer sheet.
3. WHEN the countdown reaches zero, THE Mobile_Client SHALL end the Timed Paper session and submit the recorded answers to the Backend_API.
4. WHEN a User submits a Timed Paper session before the countdown reaches zero, THE Mobile_Client SHALL end the session and submit the recorded answers to the Backend_API.
5. WHEN a Timed Paper session is submitted, THE Backend_API SHALL score every question of the PYQ_Paper against the official Answer_Key and record a Timed_Paper_Attempt containing the total score, the per-question outcome as correct, incorrect, or unanswered, and the time taken.
6. WHERE a question is unanswered when a Timed Paper session ends, THE Backend_API SHALL score that question as unanswered and count it as incorrect.
7. THE Backend_API SHALL persist each Timed_Paper_Attempt associated with the User.
8. THE Backend_API SHALL make each question answered incorrectly in a Timed_Paper_Attempt eligible to be flagged into the Mistake_Journal.

### Requirement 20: NTA Update Feed

**User Story:** As a User, I want official NTA announcements for my exam shown in the app and my exam dates kept current, so that I never miss an exam date change, admit card, or answer key release.

#### Acceptance Criteria

1. THE Backend_API SHALL periodically ingest NTA_Announcements for JEE Main, JEE Advanced, and NEET from official NTA sources via a scraper or RSS reader, including exam date changes, admit card releases, and provisional and final answer key releases.
2. WHEN the Backend_API ingests an NTA_Announcement, THE Backend_API SHALL validate and sanitize the announcement content before storing it.
3. IF an ingested NTA_Announcement is malformed or cannot be parsed, THEN THE Backend_API SHALL skip the item and exclude it from storage and display.
4. WHEN the Backend_API ingests an NTA_Announcement that duplicates an already-stored announcement, THE Backend_API SHALL de-duplicate the item and retain a single stored NTA_Announcement.
5. WHEN a User opens the NTA_Update_Feed, THE Mobile_Client SHALL display the stored NTA_Announcements in chronological order filtered to the User's Exam_Track.
6. WHEN an ingested NTA_Announcement changes a relevant exam date for the User's Exam_Track, THE Backend_API SHALL update the User's Target_Exam_Date and recompute the Target_Completion_Date and exam countdown accordingly.

### Requirement 21: Offline Mode (Read-Only) for PYQs and Focus Timer

**User Story:** As a User, I want to download papers and run my focus timer without connectivity, so that I can keep studying when I am offline and have my work synced later.

#### Acceptance Criteria

1. WHEN a User downloads a PYQ_Paper, THE Mobile_Client SHALL store the PYQ_Paper and its Answer_Key on the device as an Offline_Download for read-only use.
2. WHILE the device is offline, THE Mobile_Client SHALL allow the User to view downloaded PYQ_Papers and run the Focus Timer using local timing.
3. WHILE the device is offline, THE Mobile_Client SHALL store completed Focus_Sessions and recorded PYQ and Timed Paper answers as Local_Sync_Records, each keyed by a client-generated identifier.
4. WHEN device connectivity is restored, THE Mobile_Client SHALL sync queued Local_Sync_Records to the Backend_API.
5. WHEN the Backend_API receives a Local_Sync_Record whose client-generated identifier matches an already-synced record, THE Backend_API SHALL treat the sync as idempotent and SHALL NOT create a duplicate record.
6. WHILE the device is offline, THE Mobile_Client SHALL indicate that the AI notes summarizer and the NTA_Update_Feed are unavailable offline.

## Non-Goals

This section records what is intentionally excluded from the Phase 1 MVP and organizes deferred work into a forward-looking roadmap so that nothing proposed is lost. Items are grouped by the phase in which they are anticipated. Phase assignment reflects dependency and engineering cost, not a delivery commitment.

### Deferred from Phase 1 (existing non-goals, retained)

- **Spaced-repetition revision reminders (forgetting curve)**: auto-scheduling topic revision at +1, +3, +7, and +21 day intervals after a Chapter is marked Done is deferred to Phase 2, because it depends on push notifications and reminders, which are themselves deferred to Phase 2.
- **Passive burnout detection**: rolling 7-day study-hour and abandonment tracking with soft Progress_Dashboard nudges is deferred to Phase 2, because it requires sufficient historical usage data accumulated after launch to be meaningful.
- **Per-Session_Type analytics surface**: the dashboard breakdown of study time by Session_Type is deferred to Phase 2 and feeds the Phase 2 weak-area detection feature; the Session_Type tag itself is captured and persisted in Phase 1 (Requirement 4) so the data foundation exists at launch.
- **Other previously deferred Phase 2 features**: spaced-repetition flashcards, weak-area detection, social/accountability leaderboard, push notifications and reminders, and a full Hindi-medium UI beyond the bilingual interface support described in Requirement 10.

### Phase 2 (needs Phase 1 data or additional infrastructure)

- **Full NTA-interface Mock Test clone**: mark-for-review, section-wise time warnings, the exact NTA UI, and +4/-1 marking-scheme presentation. Phase 1 provides only the simplified Timed Paper Mode (Requirement 19).
- **Push notification of NTA feed updates and admit-card alerts**: builds on the in-app NTA_Update_Feed (Requirement 20) once push notifications are introduced.
- **Score Trajectory and Rank Prediction**: enter coaching and mock scores to project percentile or score range against target college cutoffs using public JoSAA and NEET cutoff data.
- **Topic-Wise NTA Trend Analysis**: 10-year topic frequency analysis combined with the User's weak-area data.
- **Attempt Quality Score**: accuracy percentage, time per question, and attempt-rate trends derived from PYQ and Timed Paper data.
- **Formula Vault and Active Recall Drill ("Formula Sprint")**: a formula store with timed active-recall drills.
- **Concept Map Builder**: User-built concept maps linking topics.
- **Quick Revision Capsules**: per-chapter cheat sheets.
- **Mood and Energy Tracker**: a daily check-in correlated with study output.
- **Anxiety Protocol for exam week**: box breathing, grounding, and visualization, framed as performance tools.
- **Motivational framing**: cited topper strategies and specific milestone celebrations.
- **Burnout detection and structured 3-day Burnout Recovery Mode**: active recovery plan built on accumulated usage data.
- **Coaching Class Integration Layer**: layer self-study reinforcement on top of the User's coaching schedule.
- **Study Buddy Matching**: opt-in, hours-only shared dashboard with an in-app weekly check-in.
- **Anonymous Peer Benchmarking**: aggregate study-hours comparison.
- **Doubt Tagging**: log, organize, and export doubts per chapter, with no doubt-solving.
- **Stationery and Reference Book Tracker**: a checklist for HC Verma, DC Pandey, NCERT, and MS Chauhan.
- **Ambient Study Sounds in the focus timer**: rain, cafe, white noise, and lo-fi.
- **JoSAA / NEET Counseling Guide and College/Branch Predictor**: static yearly content plus a rank-to-college predictor.
- **Strategy Simulator and Time-per-Question Pacing Trainer**: pre-mock plan versus actual comparison and pacing practice.
- **Exam Day Countdown and Checklist**: a final-week revision shift, an exam-day checklist, and night-before reassurance.
- **Regional language UI beyond Hindi**: Tamil, Telugu, Bengali, and Marathi interface support.

### Phase 3 / V2.0 (significant engineering)

- **PDF Annotation and Chapter Notes Organizer**: an in-app PDF viewer with highlight and text-note support and search.
- **Voice Notes with transcription**: Feynman-technique voice capture transcribed via a service such as Whisper or Deepgram, auto-tagged to a Chapter, and searchable across text and voice.
- **Full bidirectional offline sync of all app data**: extends the read-only Offline Mode (Requirement 21) to complete two-way synchronization.
- **Home-screen Widget**: an Android widget may be feasible in an earlier phase, while an iOS native extension is deferred.
- **AI-generated insight narratives on attempt quality**: natural-language analysis of practice and attempt data.

### North-Star Vision (not scheduled; documented to guide architecture)

- **Personalized AI Daily Briefing**: a single approximately 100-word daily synthesis across timetable, mistake journal, PYQ and mock performance, chapter completion, study velocity, and later mood data. For example: "You have 87 days to JEE Main; you're 2 chapters behind in Organic; revise Kinematics (18 days since last); take tomorrow lighter; trajectory ~94th percentile." This is the long-term differentiator. Phase 1 data models should be designed so their signals can later feed this briefing.

### Out-of-scope domains (excluded across all phases)

- Fitness or calorie tracking.
- Original exam content, video lectures, or question banks beyond official PYQs.
- Live classes, doubt-solving, or tutor marketplace functionality.
