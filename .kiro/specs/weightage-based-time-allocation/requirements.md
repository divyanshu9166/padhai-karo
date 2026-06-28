# Requirements Document

## Introduction

Weightage-Based Time Allocation is a Phase 2 capability for the JEE/NEET Study Companion, layered on the shipped Phase 1 system and on the just-completed Performance Analytics spec. Phase 1 already organizes study around a per-User Chapter catalog that carries a reference-seeded `Chapter_Weightage` and `Estimated_Study_Hours`, and it already generates a weekly Timetable of Study_Blocks whose time distribution is biased by `Chapter_Weightage` (Phase 1 Requirement 11). The Performance Analytics spec already added the `QuestionTopicMap` (which maps a PYQ question to a `Topic_Key` equal to the Phase 1 `Chapter.referenceKey`) and the year-versioned `Topic_Frequency_Reference_Data` (per-Topic historical appearance count and average questions per year), plus the topic-trend and topic-priority computations.

This feature connects those two foundations. When the User's own PYQ attempts are tagged Chapter-wise through the existing `QuestionTopicMap` (not merely by Subject), the System derives, for each Chapter, how often that Chapter appears in the User's own attempted PYQs, combines that personal signal with the pre-loaded historical `Topic_Frequency_Reference_Data`, and produces a single per-Chapter prioritization signal. From that combined signal the System surfaces which Chapters appeared most often in past papers and computes a Suggested_Time_Allocation across the User's pending Chapters. That suggested allocation then feeds into the existing Phase 1 timetable generation, augmenting the default `Chapter_Weightage`-driven distribution while continuing to honor any explicit User time-allocation or weightage overrides.

This spec is deliberately additive and reuse-only. It introduces **no new external data source**: it reads the User's own persisted Phase 1 `PYQ_Attempt` records, the existing `QuestionTopicMap`, and the existing `Topic_Frequency_Reference_Data`, and it writes only additive models or columns that leave the Phase 1 and Performance Analytics models unchanged. Every endpoint is authenticated and per-user isolated, and all new user-facing strings support English and Hindi, consistent with the established conventions.

The following are explicitly out of scope for this spec: redefining or replacing the Phase 1 timetable generator, the energy-based slot assignment, the buffer-slot reservation, or the adaptive rebalancer (this feature only influences the per-Chapter time distribution those mechanisms consume); the Performance Analytics weak-area detection, score trajectory, rank prediction, and topic-priority outputs (reused as defined, not re-specified here); and any change to how `Topic_Frequency_Reference_Data` or `QuestionTopicMap` are sourced, seeded, or versioned.

## Glossary

- **System**: The complete JEE/NEET Study Companion application, comprising the Mobile_Client and Backend_API; this feature is added to this System.
- **Mobile_Client**: The React Native (Expo) application running on the User's device (Phase 1 component, reused).
- **Backend_API**: The server-side Next.js API-routes service that handles authentication, persistence, scheduling, and analytics computation (Phase 1 component, reused).
- **Allocation_Service**: The Backend_API component introduced in this spec that derives the combined per-Chapter prioritization signal, surfaces most-frequent Chapters, and computes the Suggested_Time_Allocation by reading the User's PYQ_Attempts, the QuestionTopicMap, and the Topic_Frequency_Reference_Data.
- **User**: A registered student using the application (Phase 1 entity, reused).
- **Exam_Track**: The exam a User is preparing for, either JEE or NEET (Phase 1 entity, reused).
- **Subject**: A study subject associated with an Exam_Track (Phase 1 entity, reused).
- **Chapter**: A named per-User unit of study within a Subject, carrying a `referenceKey`, a Chapter_Weightage, an Estimated_Study_Hours, and a Chapter_Status (Phase 1 entity, reused).
- **Topic**: The finest sub-unit used by analytics; where Phase 1 records only at Chapter granularity, the Chapter SHALL serve as the Topic, and a Topic is identified by a Topic_Key (Performance Analytics definition, reused).
- **Topic_Key**: The identifier that links a PYQ question, a Topic_Frequency_Record, and a Chapter; it equals the Phase 1 `Chapter.referenceKey` (Performance Analytics definition, reused).
- **Chapter_Status**: The User's progress state for a Chapter, one of Not Started, In Progress, Done, or Revised (Phase 1 entity, reused).
- **Chapter_Weightage**: The effective measure of a Chapter's relative contribution to the Exam_Track's marks, seeded from Reference_Data and used by Phase 1 to bias time allocation (Phase 1 entity, reused).
- **Estimated_Study_Hours**: The Reference_Data estimate of the hours required to complete a Chapter (Phase 1 entity, reused).
- **PYQ**: A previous-year question record carrying an Exam_Track, a year, and a Subject (Phase 1 entity, reused).
- **PYQ_Attempt**: A User's recorded set of answers to a selected set of PYQs, with per-question outcomes and a computed score (Phase 1 entity, reused as the personal input to this feature).
- **QuestionTopicMap**: The additive mapping introduced by Performance Analytics from a PYQ question identifier to a Topic_Key (== Chapter `referenceKey`); a question without a QuestionTopicMap entry is attributable only at the Subject level (reused, not redefined).
- **Topic_Frequency_Reference_Data**: Pre-loaded, system-supplied data, keyed by Exam_Track and versioned by Reference_Data_Year, recording for each Topic the historical appearance count, the covered year span, and the average questions per year (Performance Analytics entity, reused).
- **Topic_Frequency_Record**: A single Topic_Frequency_Reference_Data entry for one Topic, holding its appearance count, year span, and average questions per year (Performance Analytics entity, reused).
- **Reference_Data_Year**: The yearly version label applied to Topic_Frequency_Reference_Data, used to select the active dataset version (Performance Analytics entity, reused).
- **PYQ_Chapter_Frequency**: The Allocation_Service measure, derived per Chapter from the User's own PYQ_Attempts joined to Chapters through the QuestionTopicMap, of how many of the User's attempted PYQ questions belong to that Chapter.
- **Historical_Chapter_Frequency**: The per-Chapter historical signal read from the Topic_Frequency_Record whose Topic_Key matches the Chapter's `referenceKey`, expressed using the record's average questions per year.
- **Combined_Weightage_Signal**: The Allocation_Service per-Chapter value that combines the Chapter's PYQ_Chapter_Frequency with its Historical_Chapter_Frequency into a single normalized prioritization measure used to rank Chapters and to compute the Suggested_Time_Allocation.
- **Most_Frequent_Chapters**: The list of the User's Chapters ordered by Combined_Weightage_Signal in descending order, surfaced as triage and allocation guidance.
- **Suggested_Time_Allocation**: The Allocation_Service-computed distribution of available study time across the User's pending Chapters, derived from the Combined_Weightage_Signal, expressed as a per-Chapter share of the total.
- **Allocation_Share**: The portion of total available study time assigned to one Chapter within a Suggested_Time_Allocation, expressed as a fraction of the total.
- **Timetable**: A generated weekly schedule of Study_Blocks across Subjects and Chapters, derived from Fixed_Commitments (Phase 1 entity, reused).
- **Study_Block**: A single scheduled study slot in the Timetable, associated with a Subject, optionally a Chapter, a start time, and a duration (Phase 1 entity, reused).
- **Time_Allocation_Override**: A User-specified time allocation for a Subject or Chapter that Phase 1 persists and applies in place of the Chapter_Weightage-driven allocation (Phase 1 behavior, reused).
- **Weightage_Override**: A User-specified Chapter_Weightage value that Phase 1 persists and retains across timetable generations until cleared (Phase 1 behavior, reused).
- **Effective_Allocation_Mode**: The User-selectable setting that determines whether the Timetable uses the Suggested_Time_Allocation or the Phase 1 default Chapter_Weightage-driven allocation as the basis for per-Chapter time distribution.
- **Subscription_Tier**: The User's access level, either Free or Paid (Phase 1 entity, reused for monetization gating).
- **Language_Preference**: The User's selected interface language, either English or Hindi (Phase 1 entity, reused).

## Requirements

### Requirement 1: Derive Per-Chapter PYQ Frequency from the User's Own Attempts

**User Story:** As an aspirant, I want the app to learn which chapters I have actually practiced from past papers, so that my own attempt history informs my study priorities.

#### Acceptance Criteria

1. WHEN a User requests weightage-based allocation guidance, THE Allocation_Service SHALL compute, for each of the User's Chapters, a PYQ_Chapter_Frequency equal to the count of the User's persisted PYQ_Attempt per-question outcomes whose question resolves to that Chapter through a QuestionTopicMap entry whose Topic_Key equals the Chapter `referenceKey`.
2. WHERE a PYQ question in a PYQ_Attempt has no QuestionTopicMap entry, THE Allocation_Service SHALL exclude that question from every Chapter's PYQ_Chapter_Frequency and SHALL include it in no Chapter count.
3. WHERE a PYQ question in a PYQ_Attempt resolves through QuestionTopicMap entries to more than one Chapter `referenceKey`, THE Allocation_Service SHALL increment the PYQ_Chapter_Frequency of each matched Chapter by exactly one for that question.
4. WHEN the Allocation_Service computes PYQ_Chapter_Frequency, THE Allocation_Service SHALL count only PYQ_Attempt records owned by the requesting User and SHALL count each owned per-question outcome at most once per Chapter.
5. IF a User has no PYQ_Attempt records, THEN THE Allocation_Service SHALL report a PYQ_Chapter_Frequency of exactly zero for every one of the User's Chapters.
6. WHEN the Allocation_Service computes PYQ_Chapter_Frequency, THE Allocation_Service SHALL read the persisted PYQ_Attempt and QuestionTopicMap records without creating, updating, or deleting any PYQ_Attempt, QuestionTopicMap, or PYQ record.

### Requirement 2: Read Historical Chapter Frequency from Reference Data

**User Story:** As an aspirant, I want the app to use the historical record of how often each chapter appeared in past papers, so that my priorities reflect the real exam pattern and not only my own practice.

#### Acceptance Criteria

1. WHEN the Allocation_Service computes the Historical_Chapter_Frequency for a Chapter, THE Allocation_Service SHALL read the Topic_Frequency_Record whose Topic_Key matches the Chapter `referenceKey` from the active Reference_Data_Year of the Topic_Frequency_Reference_Data for the User's Exam_Track and SHALL set the Chapter's Historical_Chapter_Frequency equal to that Topic_Frequency_Record's average questions per year.
2. WHEN the Allocation_Service selects the Topic_Frequency_Reference_Data version, THE Allocation_Service SHALL select as the active Reference_Data_Year the greatest Reference_Data_Year label available for the User's Exam_Track.
3. IF a Chapter has no Topic_Frequency_Record in the active Topic_Frequency_Reference_Data, THEN THE Allocation_Service SHALL report the Chapter's Historical_Chapter_Frequency as zero and label the Chapter as having no historical frequency data.
4. IF no Topic_Frequency_Reference_Data exists for the User's Exam_Track, THEN THE Allocation_Service SHALL report the Historical_Chapter_Frequency as zero for every Chapter and label each Chapter as having no historical frequency data.
5. WHEN the Allocation_Service computes Historical_Chapter_Frequency, THE Allocation_Service SHALL read the Topic_Frequency_Reference_Data without modifying any Topic_Frequency_Record.

### Requirement 3: Compute the Combined Weightage Signal

**User Story:** As an aspirant, I want a single priority signal that blends my own practice with the historical paper pattern, so that I have one trustworthy basis for allocating study time.

#### Acceptance Criteria

1. WHEN a User requests weightage-based allocation guidance, THE Allocation_Service SHALL compute a Combined_Weightage_Signal for each Chapter by combining the Chapter's PYQ_Chapter_Frequency with the Chapter's Historical_Chapter_Frequency such that the Combined_Weightage_Signal is non-negative and does not decrease when either PYQ_Chapter_Frequency or Historical_Chapter_Frequency increases while the other is held constant.
2. WHEN the Allocation_Service computes the Combined_Weightage_Signal, THE Allocation_Service SHALL normalize the Combined_Weightage_Signal across the User's Chapters onto a common scale of 0 to 1 inclusive, where the Chapter with the highest pre-normalization Combined_Weightage_Signal is assigned the value 1 and the Chapter with the lowest is assigned the value 0.
3. WHERE a Chapter has a PYQ_Chapter_Frequency of zero and a Historical_Chapter_Frequency greater than zero, THE Allocation_Service SHALL compute the Chapter's Combined_Weightage_Signal from the Historical_Chapter_Frequency alone.
4. WHERE a Chapter has a Historical_Chapter_Frequency of zero and a PYQ_Chapter_Frequency greater than zero, THE Allocation_Service SHALL compute the Chapter's Combined_Weightage_Signal from the PYQ_Chapter_Frequency alone.
5. WHERE a Chapter has both a PYQ_Chapter_Frequency of zero and a Historical_Chapter_Frequency of zero, THE Allocation_Service SHALL assign the Chapter the minimum Combined_Weightage_Signal value of 0 on the normalized scale.
6. WHEN the Allocation_Service returns the Combined_Weightage_Signal for each Chapter, THE Allocation_Service SHALL include the Reference_Data_Year of the Topic_Frequency_Reference_Data used in the computation.
7. IF the Topic_Frequency_Reference_Data required to compute the Combined_Weightage_Signal is unavailable, THEN THE Allocation_Service SHALL not return a Combined_Weightage_Signal and SHALL return an error response indicating that the reference data is unavailable.

### Requirement 4: Surface Most-Frequent Chapters as Triage Guidance

**User Story:** As an aspirant, I want to see which chapters appear most often across my practice and the historical papers, so that I can quickly tell where to focus first.

#### Acceptance Criteria

1. WHEN a User requests the Most_Frequent_Chapters, THE Allocation_Service SHALL return all of the User's Chapters ordered by Combined_Weightage_Signal in descending order.
2. WHEN the Allocation_Service returns the Most_Frequent_Chapters, THE Allocation_Service SHALL include for each Chapter its PYQ_Chapter_Frequency, its Historical_Chapter_Frequency, and its Combined_Weightage_Signal.
3. WHEN two Chapters have an equal Combined_Weightage_Signal, THE Allocation_Service SHALL order them by Historical_Chapter_Frequency in descending order.
4. WHEN two Chapters have an equal Combined_Weightage_Signal and an equal Historical_Chapter_Frequency, THE Allocation_Service SHALL order them by PYQ_Chapter_Frequency in descending order.
5. WHEN two Chapters have an equal Combined_Weightage_Signal, an equal Historical_Chapter_Frequency, and an equal PYQ_Chapter_Frequency, THE Allocation_Service SHALL order them by Chapter `referenceKey` in ascending lexicographic order so that the ordering is deterministic.
6. IF a User has no Chapters associated, THEN THE Allocation_Service SHALL return an empty Most_Frequent_Chapters list.

### Requirement 5: Compute the Suggested Time Allocation

**User Story:** As an aspirant, I want the app to suggest how to split my study time across chapters based on the combined signal, so that I spend more time on the highest-yield chapters.

#### Acceptance Criteria

1. WHEN a User requests the Suggested_Time_Allocation, THE Allocation_Service SHALL compute an Allocation_Share for each of the User's pending Chapters equal to that Chapter's Combined_Weightage_Signal divided by the sum of the Combined_Weightage_Signal values of all included Chapters, such that a Chapter with a strictly higher Combined_Weightage_Signal receives a strictly higher Allocation_Share than a Chapter with a lower Combined_Weightage_Signal.
2. THE Allocation_Service SHALL include in the Suggested_Time_Allocation only those Chapters whose Chapter_Status is Not Started or In Progress, and SHALL exclude every Chapter whose Chapter_Status is neither Not Started nor In Progress.
3. WHEN the Allocation_Service computes the Suggested_Time_Allocation, THE Allocation_Service SHALL produce Allocation_Shares that sum to one (1.0) across the included Chapters, each Allocation_Share expressed as a value in the range 0.0 to 1.0 rounded to 4 decimal places.
4. IF every pending Chapter has a Combined_Weightage_Signal of zero, THEN THE Allocation_Service SHALL set each included Chapter's Allocation_Share equal to that Chapter's Phase 1 Chapter_Weightage divided by the sum of the Phase 1 Chapter_Weightage values of all included Chapters, with the resulting shares summing to one (1.0).
5. IF a User has no pending Chapter, THEN THE Allocation_Service SHALL return an empty Suggested_Time_Allocation containing zero Chapters.

### Requirement 6: Graceful Fallback for Chapters Without Data

**User Story:** As an aspirant, I want chapters that have neither my practice data nor a historical record to still be scheduled sensibly, so that no chapter is dropped from my plan.

#### Acceptance Criteria

1. WHERE a Chapter has a PYQ_Chapter_Frequency of zero AND no Topic_Frequency_Record exists for that Chapter in the active Topic_Frequency_Reference_Data, THE Allocation_Service SHALL assign that Chapter an Allocation_Share that is directly proportional to the Chapter's Phase 1 Chapter_Weightage, normalized so that the sum of all pending Chapters' Allocation_Shares equals 1.0 within a tolerance of 0.001.
2. WHEN the Allocation_Service applies the Phase 1 Chapter_Weightage fallback for a Chapter, THE Allocation_Service SHALL set that Chapter's default-allocation label to indicate the Allocation_Share originated from the Chapter_Weightage fallback rather than from the Combined_Weightage_Signal.
3. WHERE a Chapter's Phase 1 Chapter_Weightage is itself flagged with weightageIsDefault set to true, THE Allocation_Service SHALL preserve the weightageIsDefault flag as true in that Chapter's default-allocation labeling.
4. THE Allocation_Service SHALL include every pending Chapter exactly once in the Suggested_Time_Allocation, whether the Chapter's Allocation_Share is derived from the Combined_Weightage_Signal or from the Phase 1 Chapter_Weightage fallback.
5. IF a Chapter qualifies for the Phase 1 Chapter_Weightage fallback but has no Phase 1 Chapter_Weightage value or a Phase 1 Chapter_Weightage of zero, THEN THE Allocation_Service SHALL assign that Chapter the smallest non-zero Allocation_Share among the pending Chapters, set its default-allocation label, and retain the Chapter in the Suggested_Time_Allocation so that no Chapter is dropped.

### Requirement 7: Feed the Suggested Allocation into Timetable Generation

**User Story:** As an aspirant, I want the suggested allocation to shape my generated timetable, so that the schedule I follow reflects the high-yield chapters.

#### Acceptance Criteria

1. WHILE the User's Effective_Allocation_Mode is set to use the Suggested_Time_Allocation, THE Backend_API SHALL, on each timetable generation, use the most recently computed Suggested_Time_Allocation as the per-Chapter time distribution basis in place of the Phase 1 default Chapter_Weightage-driven distribution.
2. WHILE the User's Effective_Allocation_Mode is set to use the Phase 1 default allocation, THE Backend_API SHALL generate the Timetable using the Phase 1 Chapter_Weightage-driven distribution.
3. WHEN the Backend_API generates a Timetable using the Suggested_Time_Allocation, THE Backend_API SHALL allocate Study_Blocks only to Chapters whose Chapter_Status is Not Started or In Progress.
4. WHEN the Backend_API generates a Timetable using the Suggested_Time_Allocation, THE Backend_API SHALL preserve the Phase 1 scheduling behaviors for Fixed_Commitment avoidance, non-overlap of Study_Blocks, energy-based slot assignment, and Buffer_Slot reservation.
5. WHEN the Backend_API changes the per-Chapter time distribution basis to the Suggested_Time_Allocation, THE Backend_API SHALL leave the persisted Phase 1 Chapter_Weightage values unchanged.
6. IF the User has not set an Effective_Allocation_Mode, THEN THE Backend_API SHALL generate the Timetable using the Phase 1 default Chapter_Weightage-driven distribution.
7. IF the User's Effective_Allocation_Mode is set to use the Suggested_Time_Allocation and the Suggested_Time_Allocation includes no Chapters, THEN THE Backend_API SHALL generate the Timetable using the Phase 1 Chapter_Weightage-driven distribution and leave the persisted Phase 1 Chapter_Weightage values unchanged.

### Requirement 8: Respect Existing User Overrides

**User Story:** As an aspirant who has manually adjusted my plan, I want my own time-allocation and weightage overrides to stay in control, so that the app's suggestion never silently discards my choices.

#### Acceptance Criteria

1. WHERE a User has a Time_Allocation_Override for a Subject or Chapter, THE Backend_API SHALL apply the stored Time_Allocation_Override value in place of the Suggested_Time_Allocation for that Subject or Chapter without modifying the stored override value.
2. WHERE a User has a Weightage_Override for a Chapter, THE Allocation_Service SHALL use the overridden Chapter_Weightage value in place of the Phase 1 Chapter_Weightage in every computation that would otherwise use the Phase 1 Chapter_Weightage for that Chapter.
3. WHILE a User override exists for a Chapter, THE Backend_API SHALL retain the stored override value unchanged across subsequent timetable generations until the User clears the override.
4. WHEN a User clears a Time_Allocation_Override or Weightage_Override for a Chapter, THE Backend_API SHALL resume using the Suggested_Time_Allocation (or the Phase 1 Chapter_Weightage where the Suggested_Time_Allocation falls back) for that Chapter on the next timetable generation.
5. WHEN the Allocation_Service computes the Suggested_Time_Allocation for Chapters that have a User override, THE Allocation_Service SHALL distribute the remaining available share, equal to one (1.0) minus the sum of the overridden shares, across the non-overridden Chapters in proportion to their Combined_Weightage_Signal.
6. IF the sum of the User's overridden shares meets or exceeds one (1.0), THEN THE Allocation_Service SHALL assign every non-overridden Chapter an Allocation_Share of zero and SHALL NOT reduce or discard any User override value.
7. IF every pending Chapter has a User override, THEN THE Allocation_Service SHALL apply each Chapter's override value and SHALL compute no Combined_Weightage_Signal-based distribution.

### Requirement 9: Reuse Existing Data Without a New External Source

**User Story:** As an engineer, I want this feature to read only existing persisted data and reference datasets, so that it ships additively without introducing a new data source or destabilizing shipped models.

#### Acceptance Criteria

1. THE Allocation_Service SHALL use the persisted PYQ_Attempt, QuestionTopicMap, and Topic_Frequency_Reference_Data records as the only inputs for deriving the Combined_Weightage_Signal and the Suggested_Time_Allocation, and SHALL read no other source for these two outputs.
2. THE Allocation_Service SHALL compute its outputs reading exclusively from the persisted Phase 1 data, the Performance Analytics reference data, and the requesting User's profile, and SHALL NOT read any external service, file, or data store outside these three sources.
3. WHEN this spec introduces new persisted data, THE Backend_API SHALL store the new data only in newly added models or newly added columns, and SHALL leave every existing Phase 1 and Performance Analytics model, column, and stored value unchanged with no renamed, removed, retyped, or repurposed existing column.
4. WHEN the Allocation_Service reads Phase 1 and Performance Analytics data, THE Allocation_Service SHALL perform read-only access only, issuing no create, update, or delete operation against the existing columns or values of those records.
5. IF any of the PYQ_Attempt, QuestionTopicMap, or Topic_Frequency_Reference_Data records needed for a requested computation are absent, THEN THE Allocation_Service SHALL skip producing the affected Combined_Weightage_Signal or Suggested_Time_Allocation, return a response indicating the missing-input condition, and leave all existing Phase 1 and Performance Analytics records unchanged.

### Requirement 10: Authentication and Per-User Isolation

**User Story:** As a User, I want my allocation guidance to be private to my account, so that no other User can see or influence my study plan.

#### Acceptance Criteria

1. IF a request to any weightage-based time-allocation endpoint is received without a session token, or with a session token that is missing, malformed, or expired, THEN THE Backend_API SHALL reject the request, return an authorization error, and SHALL NOT include any allocation output or User-owned data in the response.
2. WHEN an authenticated User requests any weightage-based time-allocation output, THE Allocation_Service SHALL compute the output using only data owned by the requesting User together with the system-supplied Topic_Frequency_Reference_Data and QuestionTopicMap, and SHALL exclude data owned by any other User from the computation.
3. IF a request references a PYQ_Attempt, a Chapter, or an Effective_Allocation_Mode setting that is not owned by the requesting User, THEN THE Backend_API SHALL reject the request, return an authorization error, and SHALL NOT modify any stored User-owned data.
4. IF a request references a PYQ_Attempt, a Chapter, or an Effective_Allocation_Mode setting that does not exist, THEN THE Backend_API SHALL reject the request and return an authorization error without disclosing whether the referenced resource exists.

### Requirement 11: Bilingual Support

**User Story:** As a Hindi-preferring User, I want allocation labels and messages in my chosen language, so that I can use the feature comfortably.

#### Acceptance Criteria

1. WHEN the Mobile_Client renders any new weightage-based time-allocation interface text, THE Mobile_Client SHALL display the text resolved from the localized string catalog for the Language_Preference stored on the User profile within 200 milliseconds of the text becoming visible.
2. IF the Language_Preference stored on the User profile is absent or is set to a value other than English or Hindi, THEN THE Mobile_Client SHALL display the English string for the requested weightage-based time-allocation text.
3. IF a localized string for a requested weightage-based time-allocation label is unavailable for the selected Language_Preference, THEN THE Mobile_Client SHALL display the English string for that text without displaying an empty value, placeholder key, or blank label.
4. THE System SHALL provide non-empty English and Hindi strings for 100 percent of new user-facing weightage-based time-allocation labels and messages, such that every catalog key has both an English value and a Hindi value.

### Requirement 12: Monetization Tier Consistency

**User Story:** As a product owner, I want the monetization posture of weightage-based time allocation to be explicit and consistent with the Phase 1 and Performance Analytics approach, so that access rules are predictable.

> Clarification needed: whether weightage-based time allocation belongs to the Free tier or the Paid tier is an open product decision. This requirement defaults to Free, consistent with the Phase 1 decision to keep organization, timetable, and PYQ features free, until the product owner specifies otherwise.

#### Acceptance Criteria

1. WHEN a User of the Free Subscription_Tier requests any weightage-based time-allocation output that has no Paid-tier designation, THE Backend_API SHALL return that output without applying any Subscription_Tier restriction.
2. WHERE the product owner has designated a specific weightage-based time-allocation output as Paid-tier, WHEN a User of the Free Subscription_Tier requests that output, THE Backend_API SHALL reject the request, return an upgrade-required response that identifies the requested output as Paid-tier, and SHALL NOT include any portion of that output's data in the response.
3. WHERE the product owner has designated a specific weightage-based time-allocation output as Paid-tier, WHEN a User of the Paid Subscription_Tier requests that output, THE Backend_API SHALL return that output without applying any Subscription_Tier restriction.
4. WHILE no weightage-based time-allocation output carries a Paid-tier designation, THE Backend_API SHALL grant Users of every Subscription_Tier access to every weightage-based time-allocation output.
