# Review implementation status

## Implemented in the repository

- Expo/React Native app structure is present under `mobile/src`; Android native code is generated
  under `mobile/android`, and iOS is generated during EAS/prebuild on macOS.
- Android build/test and JS quality gates run in GitHub Actions. A macOS iOS build workflow runs on
  release tags or manual dispatch.
- API passwords are Argon2id hashes; session credentials use Expo SecureStore when available.
- Production API and WebSocket endpoints are rejected unless they use HTTPS/WSS.
- Android is configured to block cleartext traffic and device-cloud backup of app data, plus obsolete
  broad storage/debug-overlay permissions. The only requested runtime capabilities are camera,
  microphone, and notifications.
- iOS camera, microphone, and photo-library purpose strings are declared in Expo config.
- Account & Privacy contains a password-verified, typed-confirmation account deletion flow backed
  by `DELETE /api/account/delete`; database foreign keys cascade associated user records.
- Offline storage, PDF/page caching, server-side authentication, per-user isolation, UPSC/SSC
  planning, progress, practice, accessibility semantics on interactive controls, and EN/HI
  localization foundations already exist in the application.

## Must be completed with external accounts or hardware

- Create the Apple signing profile, App Group entitlement, and WidgetKit target in Xcode on macOS;
  run iPhone/iPad device testing before App Store submission.
- Create Play Console/App Store Connect listings, upload real screenshots, complete Data Safety/App
  Privacy forms, and publish the privacy-policy/support URLs.
- Configure an observability provider (Sentry or Crashlytics) with a production DSN/project, then
  verify that it does not receive notes, audio, email addresses, tokens, or answers.
- Configure store-native billing before selling digital subscriptions. Razorpay can remain a
  server-side payment seam for web/non-store use, but it is not a substitute for Google Play Billing
  or StoreKit inside store builds.
- Run Android Lint on a machine with JDK 17+ and native iOS validation on macOS/Xcode. Local Android
  validation could not run on the current workstation because Java is not installed.

## Deliberately not claimed

- Certificate pinning is not enabled. Expo's JavaScript fetch layer cannot provide a reliable
  cross-platform pinning guarantee by itself; add and device-test a native pinning module only if
  your threat model requires it.
- The application does not claim 80% coverage. CI enforces tests, lint, type checks, and builds;
  coverage thresholds should be introduced only after an accurate baseline is measured.
- Hindi catalog coverage is substantial but legacy hard-coded strings still need translation review.

## Re-audit evidence — 20 September 2026

- Backend lint, type-check, production build, and the complete test suite passed locally:
  **178 test files / 1,180 tests**.
- Mobile lint, type-check, and tests passed locally: **12 test files / 71 tests**.
- The Expo public configuration was evaluated successfully; the app retains its declared
  runtime version, iOS permission text, and restricted Android permission list.
- Both GitHub Actions workflow files parse as valid YAML. The Android workflow provisions
  JDK 17 before running native Lint/tests; the release-tag workflow provisions macOS and
  builds the generated iOS workspace.
- The account-deletion handler was specifically tested for missing confirmation, wrong
  password, and an authenticated successful deletion.
- This re-audit also corrected three release-readiness defects: a duplicate mobile API-config
  module could bypass endpoint validation, More navigation labels were hard-coded in English,
  and real `.env.*` deployment files were not all ignored by the backend Git rules.

### Evidence still requiring a release environment

No source-only audit can certify physical-device behaviour or third-party operations. Before
submission, the checklist still requires Android/iOS device tests, a signed store build, legal
review/publishing of policy URLs, and live provider verification for billing, analytics/crash
reporting, calendar, AI, notifications, and any external content feeds. These are release gates,
not code defects that can be truthfully marked complete without the relevant accounts, secrets,
or Apple/Google tooling.
