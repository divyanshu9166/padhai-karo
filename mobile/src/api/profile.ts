/**
 * Profile endpoint helpers (task 21.8; Req 10.1; design "Onboarding / Profile Service").
 *
 * Thin typed wrappers over the generic {@link request} client for the profile surface the
 * localization wiring needs: reading the stored Language_Preference and persisting a change.
 * Consumed by the localization layer (`AppLocalizationProvider`) so the Mobile_Client renders
 * interface text in the language stored on the User profile (Req 10.2), with a toggle that
 * persists via `PATCH /profile/language` (Req 10.1).
 */
import { ApiError, request } from './client';

/**
 * Supported Language_Preference values. Mirrors the backend `LanguagePref` enum and the
 * localization layer's `Language` type — kept as a local literal here so the API module does
 * not import from `@/localization` (which would create an import cycle, since the localization
 * wiring imports these helpers). EN and HI are the only values (Req 10.4).
 */
export type ProfileLanguagePref = 'EN' | 'HI';

/**
 * The Profile row as returned by the Backend_API. Only `language` is consumed on the client
 * today; the rest of the row is preserved structurally so the shape stays forward-compatible.
 */
export interface ProfilePayload {
    language: ProfileLanguagePref;
    [key: string]: unknown;
}

/** Envelope returned by `GET /profile` and `PATCH /profile/language`. */
export interface ProfileResponse {
    profile: ProfilePayload;
}

/** `GET /profile` → `{ profile }`. Responds `404 NOT_FOUND` before onboarding. */
export function fetchProfile(): Promise<ProfileResponse> {
    return request<ProfileResponse>('/profile');
}

/**
 * Read the stored Language_Preference, or `null` when none is available yet — e.g. the user
 * has not completed onboarding (no profile row → `404`) or the request fails. Callers treat a
 * `null` as "no stored preference" and fall back to English (Req 10.3).
 */
export async function fetchProfileLanguage(): Promise<ProfileLanguagePref | null> {
    try {
        const { profile } = await fetchProfile();
        return profile?.language ?? null;
    } catch (err) {
        // A missing profile (pre-onboarding) is an expected 404 — degrade to "no preference".
        if (err instanceof ApiError && err.status === 404) {
            return null;
        }
        throw err;
    }
}

/**
 * `PATCH /profile/language` — persist the User's Language_Preference (Req 10.1). Returns the
 * persisted language echoed back from the updated profile.
 */
export async function updateProfileLanguage(
    language: ProfileLanguagePref,
): Promise<ProfileLanguagePref> {
    const { profile } = await request<ProfileResponse>('/profile/language', {
        method: 'PATCH',
        body: { language },
    });
    return profile.language;
}
