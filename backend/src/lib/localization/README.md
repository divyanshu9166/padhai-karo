# lib/localization

EN/HI localized string catalog and the resolver that honors the stored Language_Preference
and falls back to English when a key is missing. Implemented in task group 19 (Req 10).

This module is the shared source of truth for UI strings. The catalog ships in the client
bundle; only the selected preference is server-persisted (Prisma `LanguagePref` enum). The
Mobile_Client wires the resolver into rendering in task 21.8.

## Files

- `types.ts` — `Language` (`'EN' | 'HI'`), `LocalizedString` (`en` required, `hi` optional),
  `StringCatalog`, and `DEFAULT_LANGUAGE`.
- `catalog.ts` — `stringCatalog`: a representative starter set of keyed strings across
  onboarding, timetable, focus timer, dashboard, PYQ, mistakes, AI notes, paywall, NTA feed,
  and common actions. A few keys intentionally omit `hi` to exercise the English fallback.
  Exports the `StringKey` union and an `isStringKey` guard.
- `resolver.ts` — `resolveString(language, key, catalog?)` and `createResolver(language)`.

## API

```ts
import { resolveString, createResolver } from '@/lib/localization';

resolveString('HI', 'common.save'); // → 'सहेजें'
resolveString('EN', 'common.save'); // → 'Save'
resolveString('HI', 'common.retry'); // → 'Retry'  (no Hindi value → English fallback, Req 10.3)

const t = createResolver('HI');
t('dashboard.streak'); // → 'निरंतरता'
```

Resolution rules:

- `HI` → Hindi value when present, otherwise the English value (Req 10.3).
- `EN` → English value.
- Unknown key → the key string itself (graceful degradation; English is always present for
  known keys).

Adding a string: append one entry to `stringCatalog` with an `en` value and an optional `hi`
value. `StringKey` updates automatically.

> The Property 7 fast-check test (language round-trip with English fallback) is implemented
> separately in task 19.2.
