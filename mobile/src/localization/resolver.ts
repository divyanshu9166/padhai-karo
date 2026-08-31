/**
 * Localized string resolver (Req 10.2, 10.3, 10.4).
 *
 * COPIED FROM: backend/src/lib/localization/resolver.ts (verbatim).
 * See ./types.ts for the copy rationale. Keep in sync with the backend copy.
 *
 * Given a selected `Language_Preference` and a string key, the resolver returns
 * the string in the selected language and FALLS BACK to the English string when the key has
 * no value in the selected language (Req 10.3). EN and HI are the only supported languages
 * (Req 10.4). The resolver is a pure function so it can run unchanged on both the server and
 * the Mobile_Client.
 */

import { stringCatalog, type StringKey } from './catalog';
import type { Language, StringCatalog } from './types';

/**
 * Resolve a single localized string.
 *
 * Resolution rules:
 * - Any non-English preference uses its translation when present, otherwise English (Req 10.3).
 * - `EN` preference → the English value.
 * - English is always present for known keys, so a known key always resolves to a string.
 */
export function resolveString(
    language: Language,
    key: StringKey,
    catalog?: typeof stringCatalog,
): string;
export function resolveString(language: Language, key: string, catalog: StringCatalog): string;
export function resolveString(
    language: Language,
    key: string,
    catalog: StringCatalog = stringCatalog,
): string {
    const entry = catalog[key];

    // Unknown key: degrade gracefully to the key identifier rather than throwing.
    if (entry === undefined) {
        return key;
    }

    // The selected regional translation is used only when present; otherwise English is safe fallback.
    const translated = entry[language.toLowerCase() as 'hi' | 'ta' | 'bn' | 'te' | 'mr'];
    if (language !== 'EN' && translated !== undefined) {
        return translated;
    }

    // EN preference, or a language with no translation available, resolves to English (Req 10.3/10.4).
    return entry.en;
}

/**
 * Bind a language once and get a resolver for that language. Convenient for a render pass
 * that uses a single stored preference across many keys (Req 10.2).
 */
export function createResolver(
    language: Language,
    catalog: StringCatalog = stringCatalog,
): (key: string) => string {
    return (key: string) => resolveString(language, key, catalog);
}
