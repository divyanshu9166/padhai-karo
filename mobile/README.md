# PadhaiKaro — Mobile Client (Expo / React Native)

The user-facing mobile app for the JEE/NEET Study Companion. The backend lives in the sibling
`../backend` folder (Next.js API-only); this app talks to it over HTTPS. Task **21.1** owns the
scaffold (navigation, API client, auth/session state, onboarding gating, localization wiring);
tasks 21.2–21.9 build the feature screens.

## Tech choices

- **Expo (TypeScript)**, SDK 52, React Native 0.76.
- **Navigation: React Navigation** (native-stack + bottom-tabs). Chosen over Expo Router
  because the design's layout has an explicit `navigation/` folder and the onboarding gate is
  expressed cleanly as state-driven navigator selection in `src/navigation/RootNavigator.tsx`.
- **API base URL** comes from app config via `expo-constants`
  (`app.config.ts` → `extra.apiBaseUrl`, read in `src/config/env.ts`). It defaults to
  `http://localhost:3000/api` and is overridable with the `EXPO_PUBLIC_API_BASE_URL` env var.
  No production URL is hardcoded.
- **API client:** a single generic `request<T>(path, { method, body, signal })` in
  `src/api/client.ts` that attaches the session token as `Authorization: Bearer <token>` (set
  via `setAuthToken`) and throws a typed `ApiError` carrying the backend error code. Feature
  endpoint wrappers (`api/auth.ts`, `api/timetable.ts`, `api/offline.ts`, and per-screen
  `api.ts` modules) build on it.
- **Session token storage:** `expo-secure-store` (device keychain/keystore) with an
  `AsyncStorage` fallback when SecureStore is unavailable. See `src/state/tokenStorage.ts`.
- **Tests:** `vitest` for pure-logic units (localization resolver, dashboard helpers,
  onboarding validation). Component render tests (task 21.10) would use `jest-expo` + React
  Native Testing Library separately.

## Folder layout (`src/`)

```
api/           Generic request client + ApiError + setAuthToken, auth/timetable/offline wrappers, DTOs
components/    Shared UI (Screen, PlaceholderScreen)
config/        env.ts — resolves the API base URL from app config
localization/  EN/HI catalog + resolver (copied from backend) + React context/hook
navigation/    RootNavigator (onboarding gate) + Auth/Onboarding/Main + Practice/Notes stacks
offline/       Connectivity, on-device store, sync outbox, OfflineProvider (Req 21)
screens/       Feature screens (auth, onboarding, dashboard, timetable, focus, practice, ai, nta)
state/         AuthProvider (session/token state), tokenStorage, config
```

## Onboarding-gated routing (Req 2.6)

`src/navigation/RootNavigator.tsx` selects a navigator from `useAuth()` state:

| State | Shown |
|---|---|
| `status === 'loading'` | boot splash (validating stored token) |
| `status === 'unauthenticated'` | `AuthStack` (login / register) |
| authenticated, `profileComplete === false` | `OnboardingStack` (before the main app) |
| authenticated, `profileComplete === true` | `MainTabs` (the main app) |

`profileComplete` comes from `GET /auth/me`. After a successful `POST /onboarding`, the
onboarding screen calls `useAuth().refresh()` to re-fetch `/auth/me` and advance the gate.

## Localization (Req 10)

`src/localization/{types,catalog,resolver}.ts` are **copied from**
`../backend/src/lib/localization/` (the catalog ships in the client bundle; only the preference
is server-persisted). Each file carries a `COPIED FROM` header; keep the copies in sync when
strings change. The client adds a few `auth.*` keys not present in the backend copy.
`LocalizationContext.tsx` wraps the pure resolver in a React context (`useLocalization` / `t`),
where `t(key)` resolves by the active `Language_Preference` with English fallback.

## Running

```bash
npm install --legacy-peer-deps   # see "Install note" below
npm run typecheck                # tsc --noEmit
npm run lint                     # eslint
npm test                         # vitest (pure-logic units)
npm start                        # expo start (requires a device/emulator — out of scope for 21.1)
```

### Install note

`npm install` requires `--legacy-peer-deps` due to a peer-range mismatch between the
React Navigation v7 packages in the Expo SDK 52 set. This is a dev-time install flag only and
does not affect the app at runtime.

> Emulator runs, EAS builds, and store submission are intentionally out of scope for the
> scaffold (task 21.1).
