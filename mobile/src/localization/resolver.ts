/**
 * Localized string resolver (Req 10.2, 10.3, 10.4).
 *
 * COPIED FROM: backend/src/lib/localization/resolver.ts (verbatim).
 * See ./types.ts for the copy rationale. Keep in sync with the backend copy.
 *
 * Given a selected `Language_Preference` (EN or HI) and a string key, the resolver returns
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
 * - `HI` preference → the Hindi value when present, otherwise the English value (Req 10.3).
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

    // Hindi preference uses the Hindi value only when present; otherwise English (Req 10.3).
    if (language === 'HI' && entry.hi !== undefined) {
        return entry.hi;
    }

    // EN preference, or HI with no translation available, resolves to English (Req 10.3/10.4).
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
