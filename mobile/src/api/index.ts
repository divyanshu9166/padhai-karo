/**
 * Shared API barrel (task 21.1).
 *
 * Re-exports the generic client, the resolved base URL, the auth/profile DTOs, and every
 * feature endpoint module so callers import from a single `@/api` entry point.
 */

// Resolved Backend_API base URL (also consumed by the offline connectivity probe).
export { API_BASE_URL } from '@/config/env';

// Generic client.
export { request, setAuthToken, getAuthToken, ApiError } from './client';
export type { RequestOptions } from './client';

// Auth/profile DTOs.
export type { Credentials, PublicUser, AuthTokenResponse, AuthMeResponse } from './types';

// Auth endpoint helpers.
export { registerUser, loginUser, logoutUser, fetchMe } from './auth';

// Profile endpoints + DTOs (language preference; Req 10.1).
export {
    fetchProfile,
    fetchProfileLanguage,
    updateProfileLanguage,
} from './profile';
export type { ProfileLanguagePref, ProfilePayload, ProfileResponse } from './profile';

// Timetable + calendar-event endpoints and DTOs.
export * from './timetable';

// Offline download + sync endpoints and DTOs.
export * from './offline';
