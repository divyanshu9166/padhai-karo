# Store submission checklist

## Before internal testing

- [ ] Production API uses HTTPS and WebSocket uses WSS.
- [ ] Android Lint/tests pass with JDK 17+; iOS build passes on macOS/Xcode.
- [ ] Validate permissions on a physical Android/iOS device: camera, microphone, and notifications
  are prompted only from the corresponding user action.
- [ ] Confirm offline cache, login persistence, PDF access, quiz scoring, timetable edits, and data
  deletion flows on real devices.
- [ ] Configure crash reporting/analytics with a privacy-reviewed event schema.

## Google Play

- [ ] Verify current target SDK and 64-bit AAB requirement against Play Console before submission.
- [ ] Add privacy-policy URL, Data Safety declarations, deletion instructions, content rating, and
  support contact.
- [ ] Upload a signed AAB to Internal testing first.
- [ ] Use actual app screenshots, a 512x512 icon, and feature graphic; validate store metadata
  against the current Play Console limits.

## Apple App Store

- [ ] Configure bundle ID, signing, App Group/WidgetKit, App Privacy, support URL, and TestFlight.
- [ ] Use actual iPhone/iPad screenshots and validate the current App Store Connect metadata rules.
- [ ] Use StoreKit/IAP for store-distributed digital subscriptions.
