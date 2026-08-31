# Padhai Karo — UPSC/SSC Study Companion

First-launch study companion for UPSC CSE and SSC CGL aspirants. The existing JEE/NEET
implementation remains available as a compatibility path while the product is being migrated.

## Layout

```
padhaikaro/
  backend/   Server-side-only Next.js API service (no web frontend). See backend/README.md.
  mobile/    React Native (Expo) client — added in task group 21 (not yet scaffolded).
  .kiro/     Spec: requirements, design, and implementation tasks.
```

The `backend/` service owns all persistence, scoring, generation algorithms, quota accounting,
and authorization. The `mobile/` Expo app is the only user-facing surface.

See `.kiro/specs/jee-neet-study-app/` for the requirements, design, and task plan.

The UPSC/SSC exam registry lives in `backend/src/lib/exams/`. It models program, stage/tier,
papers, sections, scoring rules, and syllabus units without treating official marks as planning
weightage. `POST /api/onboarding` accepts the new `examProgram` + `examStage` shape, and
`GET /api/reference/exam-programs` exposes the registry to clients.
# padhai-karo
