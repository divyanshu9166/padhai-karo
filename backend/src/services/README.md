# services

Feature service modules that orchestrate business logic behind the API route handlers
(auth, onboarding/profile, reference data, chapters, timetable, focus sessions, dashboard,
audits/velocity, PYQ practice, timed papers, mistake journal, AI notes, subscriptions,
NTA feed, offline sync). API route handlers in `src/app/api/**` stay thin and delegate here.
