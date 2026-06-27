# JEE/NEET Study Companion

Phase 1 MVP monorepo for the JEE/NEET Study Companion.

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
# padhai-karo
