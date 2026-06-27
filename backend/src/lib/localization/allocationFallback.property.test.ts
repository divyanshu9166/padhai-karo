import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { stringCatalog } from './catalog';
import { resolveString } from './resolver';
import type { Language, StringCatalog } from './types';

/**
 * Property-based test for English fallback of localized allocation strings (task 13.5).
 *
 * Property 16: For any requested `allocation.*` label and any Language_Preference, resolving
 * under the Hindi preference returns the Hindi value when present and otherwise falls back to
 * the non-empty English value; resolving under an absent/unsupported language always falls
 * back to the non-empty English value — never an empty value, placeholder key, or blank label.
 *
 * Every shipped `allocation.*` entry currently carries a `hi` translation, so to genuinely
 * exercise the "Hindi unavailable" fallback path we derive a test catalog from the real
 * `allocation.*` keys with `hi` stripped from a generated subset, then assert the resolver
 * returns the English value for those keys.
 *
 * See design "Correctness Properties" → Property 16.
 *
 * Validates: Requirements 11.2, 11.3
 */

// The real, shipped allocation keys. Resolving against catalogs derived from these anchors the
// property to actual catalog content rather than synthetic keys.
const allocationKeys = (Object.keys(stringCatalog) as Array<keyof typeof stringCatalog>).filter(
    (key): key is keyof typeof stringCatalog => key.startsWith('allocation.'),
);

// A single allocation key drawn from the real catalog.
const allocationKeyArb = fc.constantFrom(...allocationKeys);

// A non-empty subset of allocation keys whose Hindi value we drop (modelling missing `hi`),
// paired with one key drawn from that subset to resolve.
const missingHiArb = fc
    .subarray(allocationKeys, { minLength: 1 })
    .chain((missing) => fc.tuple(fc.constant(missing), fc.constantFrom(...missing)));

// Languages that are neither EN nor HI: absent (undefined) or any other string. These model
// the "preference absent or unsupported" condition (Req 11.2). Cast through `Language` since
// the resolver tolerates unknown values by falling back to English.
const unsupportedLanguageArb = fc.oneof(
    fc.constant(undefined),
    fc.constant(''),
    fc
        .string()
        .filter((s) => s !== 'EN' && s !== 'HI'),
) as fc.Arbitrary<Language>;

/**
 * Build a catalog from the real allocation entries where keys in `missing` have their `hi`
 * stripped (so the resolver must fall back to English) and all other entries retain `hi`.
 */
function buildCatalog(missing: ReadonlyArray<keyof typeof stringCatalog>): StringCatalog {
    const missingSet = new Set<string>(missing);
    const catalog: StringCatalog = {};
    for (const key of allocationKeys) {
        const entry = stringCatalog[key];
        catalog[key] = missingSet.has(key) ? { en: entry.en } : { ...entry };
    }
    return catalog;
}

describe('Feature: weightage-based-time-allocation, Property 16: Localized strings fall back to English', () => {
    it('resolves an allocation key under HI to its Hindi value when present, else its non-empty English value', () => {
        fc.assert(
            fc.property(missingHiArb, ([missing, key]) => {
                const catalog = buildCatalog(missing);

                // Precondition: the chosen key has no Hindi value in the derived catalog.
                expect(catalog[key].hi).toBeUndefined();

                // Under the Hindi preference, the resolver falls back to the English value,
                // which is non-empty (never a blank label or placeholder key) (Req 11.3).
                const resolved = resolveString('HI', key, catalog);
                expect(resolved).toBe(stringCatalog[key].en);
                expect(resolved.length).toBeGreaterThan(0);
                expect(resolved).not.toBe(key);
            }),
            { numRuns: 100 },
        );
    });

    it('resolves every allocation key under HI to its real Hindi value when present', () => {
        fc.assert(
            fc.property(allocationKeyArb, (key) => {
                // Every shipped allocation.* entry carries a Hindi value; HI returns it.
                const entry = stringCatalog[key];
                expect(entry.hi).toBeDefined();
                expect(resolveString('HI', key, stringCatalog)).toBe(entry.hi);
            }),
            { numRuns: 100 },
        );
    });

    it('resolves an allocation key under an absent or unsupported language to its non-empty English value', () => {
        fc.assert(
            fc.property(allocationKeyArb, unsupportedLanguageArb, (key, language) => {
                // Preference absent or neither English nor Hindi → English string (Req 11.2),
                // and it is the non-empty English value, never a blank or placeholder (Req 11.3).
                const resolved = resolveString(language, key, stringCatalog);
                expect(resolved).toBe(stringCatalog[key].en);
                expect(resolved.length).toBeGreaterThan(0);
                expect(resolved).not.toBe(key);
            }),
            { numRuns: 100 },
        );
    });
});
