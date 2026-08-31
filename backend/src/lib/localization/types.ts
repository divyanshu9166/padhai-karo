/**
 * Localization types (Req 10).
 *
 * The system supports English, Hindi, Tamil, Bengali, Telugu and Marathi, matching the
 * `LanguagePref` enum persisted on the User profile (Req 10.4). The string catalog ships in
 * the client bundle; only the selected preference is server-persisted. This module lives in
 * the shared backend layer so it can be reused by the Mobile_Client (task 21.8).
 */

/**
 * The supported interface languages. These string literals intentionally match the Prisma
 * `LanguagePref` enum value so the persisted preference maps directly onto a
 * catalog lookup with no translation layer (Req 10.4).
 */
export type Language = 'EN' | 'HI' | 'TA' | 'BN' | 'TE' | 'MR';

/** The English language code, used as the universal fallback (Req 10.3). */
export const DEFAULT_LANGUAGE: Language = 'EN';

/**
 * A single localized UI string.
 *
 * `en` is REQUIRED and acts as the source of truth and the fallback value: every key in the
 * catalog always has an English value. Regional translations are optional — a key may ship
 * without one language translation, in which case the resolver falls back to English (Req 10.3).
 */
export interface LocalizedString {
    /** English value. Always present; used directly for EN and as the universal fallback. */
    en: string;
    /** Hindi value. Optional — when absent, the resolver returns the English value. */
    hi?: string;
    ta?: string;
    bn?: string;
    te?: string;
    mr?: string;
}

/**
 * A catalog maps stable string keys to their localized values. Keys are dot-namespaced by
 * feature area (e.g. `onboarding.title`) so adding a new string is a trivial, conflict-free
 * one-line addition.
 */
export type StringCatalog = Record<string, LocalizedString>;
