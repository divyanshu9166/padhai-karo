import type { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * Expo app configuration (task 21.1).
 *
 * The Backend_API base URL is sourced here and surfaced to the running app through
 * `expo-constants` (`Constants.expoConfig.extra.apiBaseUrl`). It is intentionally NOT a
 * hardcoded production URL:
 *
 *   - Default: a localhost URL pointing at the Next.js backend's `/api` mount during
 *     development.
 *   - Override: set the `EXPO_PUBLIC_API_BASE_URL` environment variable (e.g. in your shell,
 *     an `.env` loaded by your launcher, or EAS build secrets) to point at a deployed
 *     backend. The override always wins.
 *
 * NOTE on device testing: `localhost` resolves to the device/emulator itself, not your
 * dev machine. When testing on a physical device or Android emulator, override
 * `API_BASE_URL` with your machine's LAN IP (e.g. http://192.168.1.20:3000/api) or
 * `http://10.0.2.2:3000/api` for the Android emulator.
 */
const DEFAULT_API_BASE_URL = 'https://race-passport-footage.ngrok-free.dev/api';

export default ({ config }: ConfigContext): ExpoConfig => ({
    ...config,
    name: 'PadhaiKaro',
    slug: 'padhaikaro',
    scheme: 'padhaikaro',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
        supportsTablet: true,
        bundleIdentifier: 'com.padhaikaro.app',
    },
    android: {
        package: 'com.padhaikaro.app',
    },
    extra: {
        // Resolved at config-eval time; read at runtime via expo-constants (config/env.ts).
        apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL,
    },
});
