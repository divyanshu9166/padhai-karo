import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { stringCatalog } from './catalog';
import { resolveString } from './resolver';
import type { StringCatalog } from './types';

/**
 * Property-based test for English fallback of localized analytics strings (task 27.2).
 *
 * Validates that any `analytics.*` string key lacking a Hindi value resolves, under the Hindi
 * preference, to that key's English value. Every shipped `analytics.*` entry currently carries
 * a `hi` translation, so to genuinely exercise the fallback path we derive a test catalog from
 * the real `analytics.*` keys with `hi` stripped from a generated subset — modelling the
 * "Hindi unavailable" state — then assert the resolver returns the English value for those keys.
 *
 * See design "Correctness Properties" → Property 18.
 *
 * Validates: Requirements 15.2
 */

// The real, shipped analytics keys. Resolving against a catalog derived from these keeps the
// property anchored to actual catalog content rather than synthetic keys.
const analyticsKeys = (Object.keys(stringCatalog) as Array<keyof typeof stringCatalog>).filter(
    (key): key is keyof typeof stringCatalog => key.startsWith('analytics.'),
);

// A non-empty subset of analytics keys whose Hindi value we drop (modelling missing `hi`),
// paired with one key drawn from that subset to resolve.
const missingHiArb = fc
    .subarray(analyticsKeys, { minLength: 1 })
    .chain((missing) => fc.tuple(fc.constant(missing), fc.constantFrom(...missing)));

/**
 * Build a catalog from the real analytics entries where keys in `missing` have their `hi`
 * stripped (so the resolver must fall back to English) and all other entries retain `hi`.
 */
function buildCatalog(missing: ReadonlyArray<keyof typeof stringCatalog>): StringCatalog {
    const missingSet = new Set<string>(missing);
    const catalog: StringCatalog = {};
    for (const key of analyticsKeys) {
        const entry = stringCatalog[key];
        catalog[key] = missingSet.has(key) ? { en: entry.en } : { ...entry };
    }
    return catalog;
}

describe('Property 18: Localized analytics strings fall back to English', () => {
    // Feature: performance-analytics, Property 18: For any analytics.* string key that lacks a Hindi value, resolving it under the Hindi preference returns the English value for that key.
    it('resolves an analytics key with no Hindi value to its English value under HI', () => {
        fc.assert(
            fc.property(missingHiArb, ([missing, key]) => {
                const catalog = buildCatalog(missing);

                // Precondition: the chosen key has no Hindi value in the derived catalog.
                expect(catalog[key].hi).toBeUndefined();

                // Under the Hindi preference, the resolver falls back to the English value.
                const resolved = resolveString('HI', key, catalog);
                expect(resolved).toBe(stringCatalog[key].en);
            }),
            { numRuns: 100 },
        );
    });
});
