/**
 * Localization types (Req 10).
 *
 * COPIED FROM: backend/src/lib/localization/types.ts (verbatim).
 * The catalog + resolver are the shared source of truth for UI strings. The backend keeps
 * its own copy so the server can resolve strings too; the Mobile_Client carries this copy
 * because the catalog ships in the client bundle (design "Localization": only the selected
 * preference is server-persisted). Keep the two copies in sync when strings change.
 *
 * The System supports exactly two interface languages — English and Hindi — matching the
 * `LanguagePref` enum persisted on the User profile (Req 10.4).
 */

/**
 * The supported interface languages. These string literals intentionally match the Prisma
 * `LanguagePref` enum values (`EN`, `HI`) so the persisted preference maps directly onto a
 * catalog lookup with no translation layer (Req 10.4).
 */
export type Language = 'EN' | 'HI';

/** The English language code, used as the universal fallback (Req 10.3). */
export const DEFAULT_LANGUAGE: Language = 'EN';

/**
 * A single localized UI string.
 *
 * `en` is REQUIRED and acts as the source of truth and the fallback value: every key in the
 * catalog always has an English value. `hi` is OPTIONAL — a key may ship without a Hindi
 * translation, in which case the resolver falls back to the English string (Req 10.3).
 */
export interface LocalizedString {
    /** English value. Always present; used directly for EN and as the fallback for HI. */
    en: string;
    /** Hindi value. Optional — when absent, the resolver returns the English value. */
    hi?: string;
}

/**
 * A catalog maps stable string keys to their localized values. Keys are dot-namespaced by
 * feature area (e.g. `onboarding.title`) so adding a new string is a trivial, conflict-free
 * one-line addition.
 */
export type StringCatalog = Record<string, LocalizedString>;
