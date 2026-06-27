# localization (mobile client)

EN/HI localized string catalog, the pure resolver, and the React wiring that applies the
stored `Language_Preference` across rendered text with English fallback (Req 10).

## Provenance — this is a documented copy

`catalog.ts`, `resolver.ts`, and `types.ts` are **copied verbatim** from the backend's shared
localization module:

- `backend/src/lib/localization/catalog.ts`  → `mobile/src/localization/catalog.ts`
- `backend/src/lib/localization/resolver.ts` → `mobile/src/localization/resolver.ts`
- `backend/src/lib/localization/types.ts`    → `mobile/src/localization/types.ts`

### Why copy instead of import?

The backend (`backend/`) and the mobile client (`mobile/`) are separate packages in this
monorepo with independent dependency graphs and bundlers (Next.js/Node vs. Expo/Metro). The
mobile app cannot reach across into `backend/src` at build time. The catalog and resolver are
small, dependency-free, pure modules, so copying them keeps the client self-contained while
preserving identical resolution behavior on both sides.

### Sync policy

These three files must stay byte-for-byte identical to their backend counterparts. When a
string is added or changed in the backend catalog, mirror the change here (and vice-versa).
The intentionally-missing `hi` values (`common.retry`, `paywall.restorePurchase`) exercise the
English fallback (Req 10.3) and must be preserved on both sides.

## React wiring (mobile-only, not copied)

- `LocalizationProvider` / `useLocalization` (`LocalizationContext.tsx`) — provides the current
  `Language` and a memoized `t(key)` resolver bound to it. The provider takes its language from
  the authenticated user's stored `Language_Preference` (wired through `AuthContext`), honoring
  the stored preference over the device locale (Req 10.2). Defaults to English when no
  preference is available yet.

## Usage

```tsx
import { useLocalization } from '@/localization';

function Title() {
  const { t } = useLocalization();
  return <Text>{t('dashboard.title')}</Text>; // 'Progress' / 'प्रगति'
}
```
