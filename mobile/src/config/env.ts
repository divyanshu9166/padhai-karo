/**
 * Runtime environment configuration (task 21.1).
 *
 * Reads the Backend_API base URL that `app.config.ts` placed in `extra.apiBaseUrl`. The value
 * defaults to a localhost dev URL and is overridable via the `EXPO_PUBLIC_API_BASE_URL`
 * environment variable at start/build time (see `app.config.ts`). No production URL is baked in.
 */
import Constants from 'expo-constants';

import { validateProductionEndpoints } from './endpointSecurity';

/** Fallback used only if the config somehow did not provide a value (keeps the app bootable). */
const FALLBACK_API_BASE_URL = 'http://localhost:3000/api';

interface AppExtra {
    apiBaseUrl?: string;
    wsUrl?: string;
}

function readExtra(): AppExtra {
    const extra =
        (Constants.expoConfig?.extra as AppExtra | undefined) ??
        ((Constants as unknown as { manifest?: { extra?: AppExtra } }).manifest?.extra ?? {});
    return extra;
}

/** The base URL the API client targets, e.g. `http://localhost:3000/api`. */
const configuredApiBaseUrl = readExtra().apiBaseUrl ?? FALLBACK_API_BASE_URL;
const configuredWsUrl = readExtra().wsUrl ?? configuredApiBaseUrl.replace(/^http/i, 'ws').replace(/\/api\/?$/, '') + '/ws/community';

const isDevelopmentBuild = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
validateProductionEndpoints(configuredApiBaseUrl, configuredWsUrl, isDevelopmentBuild);

export const API_BASE_URL: string = configuredApiBaseUrl;
export const COMMUNITY_WS_URL: string = configuredWsUrl;
export { validateProductionEndpoints } from './endpointSecurity';
