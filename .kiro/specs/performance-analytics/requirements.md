# Requirements Document

## Introduction

Performance Analytics is the first Phase 2 capability cluster for the JEE/NEET Study Companion, layered on the completed Phase 1 system. Where Phase 1 organized study and captured signals (PYQ and timed-paper attempts, the categorized mistake journal, focus sessions with session types), Phase 2 turns those persisted signals into insight. This spec specifies four analytics capabilities and their cross-cutting constraints:

1. **Score Trajectory and Rank Prediction** — the User enters scores from external coaching/mock series (e.g., Allen, Aakash); the System combines these with the User's own app-derived PYQ and timed-paper scores, plots the trajectory over time, estimates a JEE Main percentile or NEET score range from current performance, and shows the score improvement needed to reach a target college cutoff using pre-loaded public JoSAA (JEE) and NEET counseling cutoff data.
2. **Topic-Wise NTA Trend Analysis** — pre-loaded reference data of how often each topic/chapter appeared in the last ~10 years of JEE Main/NEET and the average questions per year, surfaced as triage guidance and combined with the User's own weak-area data.
3. **Attempt Quality Score** — a per-attempt measure of accuracy percentage, average time per question, and unattempted-question count, tracked as a quality trend over time separately from content knowledge.
4. **Weak-Area Detection** — weak areas derived per subject/chapter/topic from the User's PYQ attempts, timed-paper per-question outcomes, and categorized mistake-journal entries (including the Session_Type data captured but not surfaced in Phase 1), ranked and fed into the topic-trend combination above.

This cluster reuses Phase 1 data as its primary input (per the Phase 1 design's "Architectural Seams for Deferred Features"), reads that data without requiring Phase 1 schema rewrites (additive models/columns only), introduces new year-versioned reference datasets (topic frequency and cutoff data) analogous to the Phase 1 Reference_Data approach, keeps every analytics endpoint authenticated and per-user isolated, and supports English and Hindi for all new user-facing strings.

The following are explicitly out of scope for this spec and belong to other Phase 2 specs: the AI Daily Briefing synthesis, the formula vault/flashcards, mood/burnout tracking, push notifications, study buddy/social features, coaching-schedule integration, and the JoSAA counseling step-by-step walkthrough UI (only the cutoff data used for rank prediction is in scope here, not a full counseling guide).

## Glossary

- **System**: The complete JEE/NEET Study Companion application, comprising the Mobile_Client and Backend_API; Phase 2 Performance Analytics is added to this System.
- **Mobile_Client**: The React Native (Expo) application running on the User's device (Phase 1 component, reused).
- **Backend_API**: The server-side Next.js API-routes service that handles authentication, persistence, scoring, and analytics computation (Phase 1 component, reused).
- **Analytics_Service**: The Backend_API component introduced in this spec that computes all Performance Analytics outputs (score trajectory, rank prediction, topic trend analysis, attempt quality, and weak-area detection) by reading persisted Phase 1 data and the new reference datasets.
- **User**: A registered student using the application (Phase 1 entity, reused).
- **Exam_Track**: The exam a User is preparing for, either JEE or NEET (Phase 1 entity, reused).
- **Subject**: A study subject associated with an Exam_Track (Phase 1 entity, reused).
- **Chapter**: A named unit of study within a Subject (Phase 1 entity, reused).
- **Topic**: A named sub-unit of a Chapter used as the finest granularity for trend analysis and weak-area detection; where Phase 1 data is recorded only at Chapter granularity, the Chapter SHALL serve as the Topic.
- **PYQ_Attempt**: A User's recorded set of answers to a selected set of PYQs, with per-question outcomes and a computed score (Phase 1 entity, reused as an analytics input).
- **Timed_Paper_Attempt**: The persisted result of a Timed Paper Mode session, recording the total score, per-question outcome (correct, incorrect, or unanswered), and time taken (Phase 1 entity, reused as an analytics input).
- **Mistake_Journal_Entry**: A categorized record of an incorrectly answered or User-flagged question, storing the question reference, submitted answer, correct answer, Mistake_Category, and optional note (Phase 1 entity, reused as an analytics input).
- **Mistake_Category**: The classification of a Mistake_Journal_Entry, one of Silly Mistake, Concept Gap, Time Pressure, or Never Seen This (Phase 1 entity, reused).
- **Focus_Session**: A timed study period tagged to a Subject and a Session_Type (Phase 1 entity, reused as an analytics input).
- **Session_Type**: The category of a Focus_Session, one of New Chapter, Practice Problems, Revision, Mock Analysis, or Formula Drill (Phase 1 data captured but not surfaced in Phase 1; surfaced by analytics in this spec).
- **Subscription_Tier**: The User's access level, either Free or Paid (Phase 1 entity, reused for monetization gating).
- **Language_Preference**: The User's selected interface language, either English or Hindi (Phase 1 entity, reused).
- **External_Mock_Score**: A User-entered result from an external coaching or mock test series, recording the Mock_Series_Source, the test date, the obtained score, and the maximum possible score.
- **Mock_Series_Source**: The named provider of an External_Mock_Score (e.g., Allen, Aakash, or an Other label with a free-text name).
- **App_Derived_Score**: A score data point computed by the System from a persisted PYQ_Attempt or Timed_Paper_Attempt, expressed as obtained marks out of the attempt's maximum marks.
- **Score_Data_Point**: A single dated score value used in a Score_Trajectory, sourced from either an External_Mock_Score or an App_Derived_Score, normalized to a comparable percentage of maximum marks.
- **Score_Trajectory**: The time-ordered series of a User's Score_Data_Points used to visualize performance over time.
- **Rank_Prediction**: The Analytics_Service estimate of a JEE Main percentile (for the JEE Exam_Track) or a NEET score range (for the NEET Exam_Track) derived from the User's recent Score_Data_Points.
- **JEE_Percentile_Estimate**: A Rank_Prediction expressed as an estimated JEE Main percentile band for a JEE-track User.
- **NEET_Score_Range_Estimate**: A Rank_Prediction expressed as an estimated NEET score range for a NEET-track User.
- **Target_College_Cutoff**: A User-selected entry from Cutoff_Reference_Data representing the closing rank or score for a target college, branch, or category.
- **Cutoff_Reference_Data**: Pre-loaded, system-supplied public JoSAA (JEE) and NEET counseling cutoff data, keyed by Exam_Track and versioned by Reference_Data_Year.
- **Score_Improvement_Gap**: The Analytics_Service computation of the difference between the User's current estimated standing (Rank_Prediction) and the standing required to meet a selected Target_College_Cutoff, expressed in the units of the cutoff (percentile, rank, or marks).
- **Topic_Frequency_Reference_Data**: Pre-loaded, system-supplied data, keyed by Exam_Track and versioned by Reference_Data_Year, recording for each Topic the number of appearances across the most recent available ~10 years of JEE Main/NEET papers and the average number of questions per year.
- **Topic_Frequency_Record**: A single Topic_Frequency_Reference_Data entry for one Topic, holding its appearance count, the year span covered, and its average questions per year.
- **Reference_Data_Year**: The yearly version label applied to Cutoff_Reference_Data and Topic_Frequency_Reference_Data, used to select the active dataset version and to support yearly updates.
- **Topic_Priority**: The Analytics_Service triage ranking of a Topic that combines the Topic's Topic_Frequency_Record with the User's Weak_Area_Score for that Topic.
- **Weak_Area**: A Subject, Chapter, or Topic identified by the Analytics_Service as an area of low performance for a User, derived from the User's PYQ_Attempts, Timed_Paper_Attempt per-question outcomes, and Mistake_Journal_Entries.
- **Weak_Area_Score**: The numeric measure assigned to a Weak_Area that determines its rank among the User's Weak_Areas, where a higher Weak_Area_Score indicates a greater need for attention.
- **Attempt_Quality_Score**: The per-attempt measure computed for a PYQ_Attempt or Timed_Paper_Attempt from its Accuracy_Percentage, Average_Time_Per_Question, and Unattempted_Count.
- **Accuracy_Percentage**: For one attempt, the count of correctly answered questions divided by the count of attempted (answered) questions, expressed as a percentage.
- **Average_Time_Per_Question**: For one attempt, the total time taken divided by the count of questions in the attempt.
- **Unattempted_Count**: For one attempt, the number of questions left unanswered.
- **Attempt_Rate**: For one attempt, the count of attempted (answered) questions divided by the total count of questions in the attempt, expressed as a percentage.
- **Attempt_Quality_Trend**: The time-ordered series of a User's Attempt_Quality_Score components used to show change in attempt quality over time, reported separately from content-knowledge metrics.

## Requirements

### Requirement 1: External Mock Score Entry

**User Story:** As an aspirant attending external coaching, I want to enter my Allen/Aakash mock test scores into the app, so that my full performance picture includes tests taken outside the app.

#### Acceptance Criteria

1. WHEN a User submits an External_Mock_Score with a Mock_Series_Source, a test date, an obtained score, and a maximum possible score, THE Backend_API SHALL persist the External_Mock_Score associated with the User.
2. IF a User submits an External_Mock_Score whose obtained score is negative or greater than the submitted maximum possible score, THEN THE Backend_API SHALL reject the External_Mock_Score and return a validation error.
3. IF a User submits an External_Mock_Score whose maximum possible score is zero or negative, THEN THE Backend_API SHALL reject the External_Mock_Score and return a validation error.
4. IF a User submits an External_Mock_Score whose test date is later than the current date, THEN THE Backend_API SHALL reject the External_Mock_Score and return a validation error.
5. WHEN a User edits or deletes a previously submitted External_Mock_Score, THE Backend_API SHALL persist the change for that User.

### Requirement 2: Score Trajectory Visualization

**User Story:** As a User, I want to see my mock and practice scores plotted over time, so that I can tell whether my performance is trending up or down.

#### Acceptance Criteria

1. WHEN a User requests the Score_Trajectory, THE Analytics_Service SHALL return a time-ordered series of Score_Data_Points combining the User's External_Mock_Scores and the App_Derived_Scores from the User's PYQ_Attempts and Timed_Paper_Attempts.
2. THE Analytics_Service SHALL normalize each Score_Data_Point to a percentage of its maximum possible marks so that External_Mock_Scores and App_Derived_Scores are plotted on a common scale.
3. THE Analytics_Service SHALL label each Score_Data_Point with its source as one of External_Mock, PYQ_Attempt, or Timed_Paper_Attempt.
4. WHEN a User requests the Score_Trajectory filtered by a date range, THE Analytics_Service SHALL return only the Score_Data_Points whose date falls within the requested range.
5. IF a User has no External_Mock_Scores, no PYQ_Attempts, and no Timed_Paper_Attempts, THEN THE Analytics_Service SHALL return an empty Score_Trajectory.

### Requirement 3: Rank and Percentile Prediction

**User Story:** As a User, I want an estimate of my JEE percentile or NEET score range from my current performance, so that I know roughly where I stand.

#### Acceptance Criteria

1. WHEN a JEE-track User requests a Rank_Prediction, THE Analytics_Service SHALL return a JEE_Percentile_Estimate derived from the User's recent Score_Data_Points using the percentile mapping defined in the active Cutoff_Reference_Data for the JEE Exam_Track.
2. WHEN a NEET-track User requests a Rank_Prediction, THE Analytics_Service SHALL return a NEET_Score_Range_Estimate derived from the User's recent Score_Data_Points using the score mapping defined in the active Cutoff_Reference_Data for the NEET Exam_Track.
3. THE Analytics_Service SHALL present every Rank_Prediction as an estimate range rather than a single exact value.
4. IF a User has fewer than the minimum number of Score_Data_Points required to compute a Rank_Prediction, THEN THE Analytics_Service SHALL return an insufficient-data response identifying the minimum number of Score_Data_Points required.
5. WHEN the Analytics_Service computes a Rank_Prediction, THE Analytics_Service SHALL include the Reference_Data_Year of the Cutoff_Reference_Data used in the computation.

### Requirement 4: Score Improvement Gap to Target Cutoff

**User Story:** As a User, I want to see how much I need to improve to reach a target college cutoff, so that I have a concrete goal.

#### Acceptance Criteria

1. WHEN a User selects a Target_College_Cutoff from the Cutoff_Reference_Data for the User's Exam_Track, THE Backend_API SHALL persist the selected Target_College_Cutoff associated with the User.
2. WHEN a User requests the Score_Improvement_Gap for a selected Target_College_Cutoff, THE Analytics_Service SHALL return the difference between the User's current Rank_Prediction and the standing required by the Target_College_Cutoff, expressed in the units of the Target_College_Cutoff.
3. WHILE the User's current Rank_Prediction already meets or exceeds the selected Target_College_Cutoff, THE Analytics_Service SHALL report the Score_Improvement_Gap as met and report the margin by which the Target_College_Cutoff is exceeded.
4. IF a User requests a Score_Improvement_Gap without having selected a Target_College_Cutoff, THEN THE Analytics_Service SHALL return a validation error indicating that a Target_College_Cutoff selection is required.
5. WHEN the Analytics_Service reports a Score_Improvement_Gap, THE Analytics_Service SHALL include the Reference_Data_Year of the Cutoff_Reference_Data used.

### Requirement 5: Cutoff Reference Data

**User Story:** As a product operator, I want the JoSAA and NEET counseling cutoff data pre-loaded and versioned by year, so that rank prediction uses authoritative reference data that can be refreshed yearly.

#### Acceptance Criteria

1. THE Backend_API SHALL store Cutoff_Reference_Data as system-supplied data keyed by Exam_Track and labeled with a Reference_Data_Year.
2. WHEN the Analytics_Service reads Cutoff_Reference_Data, THE Analytics_Service SHALL select the most recent Reference_Data_Year available for the requested Exam_Track.
3. WHEN a new Reference_Data_Year of Cutoff_Reference_Data is loaded, THE Backend_API SHALL retain the prior Reference_Data_Year versions.
4. IF no Cutoff_Reference_Data exists for a User's Exam_Track, THEN THE Analytics_Service SHALL return a reference-data-unavailable response for any request that requires cutoff data.

### Requirement 6: Topic Frequency Reference Data

**User Story:** As a product operator, I want the 10-year topic frequency data pre-loaded and versioned by year, so that trend analysis reflects authoritative historical paper composition.

#### Acceptance Criteria

1. THE Backend_API SHALL store Topic_Frequency_Reference_Data as system-supplied Topic_Frequency_Records keyed by Exam_Track and labeled with a Reference_Data_Year.
2. THE Backend_API SHALL store, in each Topic_Frequency_Record, the Topic's appearance count, the year span covered, and the average questions per year.
3. WHEN the Analytics_Service reads Topic_Frequency_Reference_Data, THE Analytics_Service SHALL select the most recent Reference_Data_Year available for the requested Exam_Track.
4. WHEN a new Reference_Data_Year of Topic_Frequency_Reference_Data is loaded, THE Backend_API SHALL retain the prior Reference_Data_Year versions.

### Requirement 7: Topic-Wise NTA Trend Analysis

**User Story:** As a User, I want to see how frequently each topic has appeared in past papers, so that I can prioritize high-yield topics.

#### Acceptance Criteria

1. WHEN a User requests the topic trend analysis for the User's Exam_Track, THE Analytics_Service SHALL return each Topic together with its appearance count and average questions per year from the active Topic_Frequency_Reference_Data.
2. WHEN the Analytics_Service returns the topic trend analysis, THE Analytics_Service SHALL order the Topics by average questions per year in descending order.
3. IF a Topic has no Topic_Frequency_Record in the active Topic_Frequency_Reference_Data, THEN THE Analytics_Service SHALL include the Topic with an appearance count of zero and an average questions per year of zero and label the Topic as having no historical frequency data.

### Requirement 8: Combined Topic Prioritization

**User Story:** As a User, I want topics that are both high-frequency and among my weakest flagged for priority, so that I focus where it matters most.

#### Acceptance Criteria

1. WHEN a User requests Topic_Priority guidance, THE Analytics_Service SHALL compute a Topic_Priority for each Topic by combining the Topic's average questions per year from the Topic_Frequency_Reference_Data with the User's Weak_Area_Score for that Topic.
2. WHEN the Analytics_Service returns Topic_Priority guidance, THE Analytics_Service SHALL order the Topics by Topic_Priority in descending order.
3. WHERE a Topic is both above the high-frequency threshold of the Topic_Frequency_Reference_Data and ranked among the User's Weak_Areas, THE Analytics_Service SHALL label the Topic as a combined high-frequency-and-weak priority Topic.
4. IF a User has no Weak_Areas, THEN THE Analytics_Service SHALL compute Topic_Priority from the Topic_Frequency_Reference_Data alone.

### Requirement 9: Attempt Quality Score

**User Story:** As a User, I want each practice attempt scored on quality, not just marks, so that I can see how well I attempted rather than only what I knew.

#### Acceptance Criteria

1. WHEN a User requests the Attempt_Quality_Score for a PYQ_Attempt or a Timed_Paper_Attempt, THE Analytics_Service SHALL compute and return the attempt's Accuracy_Percentage, Average_Time_Per_Question, Unattempted_Count, and Attempt_Rate.
2. THE Analytics_Service SHALL compute Accuracy_Percentage as the count of correctly answered questions divided by the count of attempted questions, expressed as a percentage.
3. IF an attempt has zero attempted questions, THEN THE Analytics_Service SHALL report the Accuracy_Percentage as zero for that attempt.
4. WHERE the attempt is a PYQ_Attempt that has no recorded time taken, THE Analytics_Service SHALL omit the Average_Time_Per_Question and label it as unavailable for that attempt.
5. THE Analytics_Service SHALL compute the Attempt_Quality_Score components from the attempt's persisted per-question outcomes without modifying the stored PYQ_Attempt or Timed_Paper_Attempt.

### Requirement 10: Attempt Quality Trend

**User Story:** As a User, I want to track changes in my attempt quality over time, so that I can tell whether my exam technique is improving independently of my knowledge.

#### Acceptance Criteria

1. WHEN a User requests the Attempt_Quality_Trend, THE Analytics_Service SHALL return a time-ordered series of Accuracy_Percentage, Average_Time_Per_Question, and Attempt_Rate values across the User's attempts.
2. THE Analytics_Service SHALL report the Attempt_Quality_Trend separately from the content-knowledge metrics of the Score_Trajectory.
3. WHEN the Analytics_Service reports the Attempt_Quality_Trend, THE Analytics_Service SHALL report the direction of change of Accuracy_Percentage and of Attempt_Rate between the earliest and latest attempts in the requested range as one of increased, decreased, or unchanged.
4. WHEN a User requests the Attempt_Quality_Trend filtered by Subject, THE Analytics_Service SHALL return only the values from attempts belonging to the selected Subject.
5. IF a User has fewer than two attempts in the requested range, THEN THE Analytics_Service SHALL return an insufficient-data response indicating that at least two attempts are required to report a direction of change.

### Requirement 11: Weak-Area Detection

**User Story:** As a User, I want the app to identify my weak subjects, chapters, and topics, so that I know what to work on without analyzing my data myself.

#### Acceptance Criteria

1. WHEN a User requests Weak_Area detection, THE Analytics_Service SHALL derive Weak_Areas per Subject, Chapter, and Topic from the User's PYQ_Attempts, Timed_Paper_Attempt per-question outcomes, and Mistake_Journal_Entries.
2. THE Analytics_Service SHALL include the count of Mistake_Journal_Entries per Mistake_Category in the derivation of each Weak_Area_Score.
3. THE Analytics_Service SHALL read the Session_Type of the User's Focus_Sessions and include the per-Session_Type study-time distribution in the Weak_Area detection output.
4. WHERE a Subject, Chapter, or Topic has no PYQ_Attempt outcomes, no Timed_Paper_Attempt outcomes, and no Mistake_Journal_Entries for the User, THE Analytics_Service SHALL exclude that Subject, Chapter, or Topic from the Weak_Areas.
5. WHEN the Analytics_Service computes Weak_Areas, THE Analytics_Service SHALL read the persisted Phase 1 data without modifying any PYQ_Attempt, Timed_Paper_Attempt, Mistake_Journal_Entry, or Focus_Session record.

### Requirement 12: Weak-Area Ranking

**User Story:** As a User, I want my weak areas ranked, so that I can address the most pressing gaps first and feed them into topic prioritization.

#### Acceptance Criteria

1. WHEN the Analytics_Service returns Weak_Areas, THE Analytics_Service SHALL assign each Weak_Area a Weak_Area_Score and order the Weak_Areas by Weak_Area_Score in descending order.
2. THE Analytics_Service SHALL make the per-Topic Weak_Area_Score available as an input to the Topic_Priority computation.
3. WHEN two Weak_Areas have an equal Weak_Area_Score, THE Analytics_Service SHALL order them by their count of incorrect outcomes in descending order.

### Requirement 13: Reuse of Phase 1 Data with Additive Schema

**User Story:** As an engineer, I want analytics to read existing Phase 1 data without rewriting the Phase 1 schema, so that Phase 2 ships without destabilizing the shipped product.

#### Acceptance Criteria

1. THE Analytics_Service SHALL use the persisted PYQ_Attempt, Timed_Paper_Attempt, Mistake_Journal_Entry, and Focus_Session records as the primary inputs for all Performance Analytics outputs.
2. WHEN the Analytics_Service reads Phase 1 data, THE Analytics_Service SHALL read the records without altering the existing Phase 1 columns or values of those records.
3. WHERE this spec introduces new persisted data, THE Backend_API SHALL store the new data in additive models or additive columns that leave the existing Phase 1 models and columns unchanged.

### Requirement 14: Authentication and Per-User Isolation

**User Story:** As a User, I want my analytics to be private to my account, so that no other User can see my performance data.

#### Acceptance Criteria

1. WHEN a request to any Performance Analytics endpoint is received without a valid session token, THE Backend_API SHALL reject the request and return an authorization error.
2. WHEN an authenticated User requests any Performance Analytics output, THE Analytics_Service SHALL compute the output using only data owned by the requesting User.
3. IF a request references an External_Mock_Score, a Target_College_Cutoff selection, a PYQ_Attempt, or a Timed_Paper_Attempt that is not owned by the requesting User, THEN THE Backend_API SHALL reject the request and return an authorization error.

### Requirement 15: Bilingual Support

**User Story:** As a Hindi-preferring User, I want analytics labels and messages in my chosen language, so that I can use the analytics features comfortably.

#### Acceptance Criteria

1. WHEN the Mobile_Client renders any new Performance Analytics interface text, THE Mobile_Client SHALL display the text in the Language_Preference stored on the User profile using the localized string catalog.
2. WHERE a localized string for a Performance Analytics label is unavailable for the selected Language_Preference, THE Mobile_Client SHALL display the English string for that text.
3. THE System SHALL provide English and Hindi strings for all new user-facing Performance Analytics labels and messages.

### Requirement 16: Monetization Tier for Advanced Analytics

**User Story:** As a product owner, I want to decide whether advanced analytics are free or paid, so that the monetization posture is explicit and consistent with the Phase 1 approach.

> Clarification needed: whether Performance Analytics is part of the Free tier or the Paid tier is an open product decision. This requirement defaults to Free, consistent with the Phase 1 decision to keep organization and PYQ features free, until the product owner specifies otherwise.

#### Acceptance Criteria

1. THE Backend_API SHALL make all Performance Analytics outputs available to Users of the Free Subscription_Tier by default.
2. WHERE the product owner designates a specific Performance Analytics output as Paid-tier, THE Backend_API SHALL reject requests for that output from Free Subscription_Tier Users and return an upgrade-required response.
3. WHILE no Performance Analytics output is designated as Paid-tier, THE Backend_API SHALL grant Users of all Subscription_Tiers access to every Performance Analytics output.
