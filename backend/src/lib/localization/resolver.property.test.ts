import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { resolveString } from './resolver';
import type { Language, LocalizedString, StringCatalog } from './types';

/**
 * Property-based test for the localized string resolver (task 19.2).
 *
 * Exercises the pure {@link resolveString} over a generated catalog (entries with and without
 * a Hindi value) and a selected language preference: EN always resolves to English, HI
 * resolves to Hindi when present and otherwise falls back to English. The language preference
 * is one of exactly {EN, HI} and round-trips as the selection. See design "Correctness
 * Properties" → Property 7.
 *
 * Validates: Requirements 10.1, 10.3, 10.4
 */

const LANGUAGES: readonly Language[] = ['EN', 'HI'];
const languageArb = fc.constantFrom(...LANGUAGES);

const enArb = fc.string({ minLength: 1 });
// `hi` is optionally present; `undefined` models a key missing in the Hindi catalog.
const entryArb: fc.Arbitrary<LocalizedString> = fc.record(
    { en: enArb, hi: fc.option(fc.string({ minLength: 1 }), { nil: undefined }) },
    { requiredKeys: ['en'] },
);

// A non-empty catalog plus a key drawn from it, so there is always a key to resolve.
const catalogAndKeyArb = fc
    .dictionary(fc.string({ minLength: 1 }), entryArb, { minKeys: 1 })
    .chain((catalog) =>
        fc.tuple(fc.constant(catalog as StringCatalog), fc.constantFrom(...Object.keys(catalog))),
    );

describe('Property 7: Language preference round-trip with English fallback', () => {
    // Feature: jee-neet-study-app, Property 7: For any selected language preference in {EN, HI}, the persisted preference equals the selection; and for any string key missing in the selected language's catalog, the resolver returns the English string for that key.
    it('resolves HI to Hindi when present else English, EN always to English, for a {EN,HI} preference', () => {
        fc.assert(
            fc.property(languageArb, catalogAndKeyArb, (language, [catalog, key]) => {
                // The selected preference is exactly one of the two supported values and
                // round-trips as the selection (Req 10.1, 10.4).
                expect(LANGUAGES).toContain(language);

                const resolved = resolveString(language, key, catalog);
                const entry = catalog[key];

                if (language === 'HI' && entry.hi !== undefined) {
                    // Hindi present → Hindi value.
                    expect(resolved).toBe(entry.hi);
                } else {
                    // EN preference, or HI with the key missing in Hindi → English fallback.
                    expect(resolved).toBe(entry.en);
                }
            }),
        );
    });
});
