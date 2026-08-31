# iOS widget source

`PadhaiKaroWidget.swift` is the WidgetKit target source. `PadhaiKaroWidgetBridge.swift/.m` is
the React Native bridge for writing `todayMinutes` and `pendingTopics` into the shared suite and
calling `WidgetCenter.shared.reloadTimelines(ofKind: "PadhaiKaroWidget")`.

The Expo config plugin at `mobile/plugins/withPadhaiKaroWidget.ts` now automates the native
project wiring on macOS: it copies the sources and Info.plist, creates and embeds the
`PadhaiKaroWidget` app-extension target, adds the bridge to the main app, and adds
`group.com.padhaikaro.app` to the app entitlements. It is idempotent and is already registered
in `app.config.ts`.

On macOS, run:

```sh
npx expo prebuild --platform ios
npx expo run:ios
```

In Xcode, select the Apple Developer Team for both `PadhaiKaro` and `PadhaiKaroWidget`, enable
the App Group `group.com.padhaikaro.app` for both targets, and confirm the widget extension is
embedded under the main app target. The App Group identifier must also exist in the Apple
Developer portal. These signing/provisioning operations require macOS + Xcode and cannot be
completed or verified from Windows; they are the only remaining platform step.
