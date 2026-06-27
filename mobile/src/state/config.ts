/**
 * Runtime app configuration.
 *
 * The Backend_API base URL is provided through `app.config.ts` (`extra.apiBaseUrl`), which
 * reads the `API_BASE_URL` env var with a localhost default. It is surfaced here via
 * `expo-constants` so it is never hardcoded at the call sites and can be overridden per
 * environment without code changes.
 */
import Constants from 'expo-constants';

/** Fallback used only if the Expo config could not be read (should not happen at runtime). */
const FALLBACK_API_BASE_URL = 'http://localhost:3000/api';

interface AppExtra {
    apiBaseUrl?: string;
}

function readExtra(): AppExtra {
    // `expoConfig` is the modern accessor; fall back defensively for older runtimes.
    const extra =
        (Constants.expoConfig?.extra as AppExtra | undefined) ??
        ((Constants as unknown as { manifest?: { extra?: AppExtra } }).manifest?.extra ?? {});
    return extra;
}

/** The resolved Backend_API base URL (e.g. `http://localhost:3000/api`). */
export const API_BASE_URL: string = readExtra().apiBaseUrl ?? FALLBACK_API_BASE_URL;
