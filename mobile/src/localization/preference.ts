/**
 * Language preference resolution (task 21.8; Req 10.2/10.3).
 *
 * A tiny pure helper that decides the active interface language from the value stored on the
 * User profile. The stored Language_Preference governs rendering and overrides the device
 * locale (Req 10.2); when no preference is stored yet — e.g. before onboarding, or when the
 * profile fetch fails — the System falls back to English (Req 10.3, {@link DEFAULT_LANGUAGE}).
 *
 * Kept free of React/React Native so it is unit-testable in a plain Node environment.
 */
import { DEFAULT_LANGUAGE, type Language } from './types';

/**
 * Resolve the active language from a (possibly absent) stored Language_Preference.
 *
 * - A stored `EN`/`HI` value is used as-is — the stored preference governs, overriding the
 *   device locale (Req 10.2).
 * - `null`/`undefined` (no stored preference) resolves to English (Req 10.3).
 */
export function resolveStoredLanguage(stored: Language | null | undefined): Language {
    return stored ?? DEFAULT_LANGUAGE;
}
