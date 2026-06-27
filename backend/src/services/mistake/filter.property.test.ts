/**
 * Property-based test for Mistake-Journal filtering.
 *
 *   - Property 37 (task 14.4): mistake-journal filtering (Req 18.5, 18.6).
 *
 * A single fast-check assertion running the global >= 100 iterations (configured in
 * vitest.setup.ts), placed next to the pure {@link buildMistakeWhere} logic it validates.
 * The `where` clause is ALWAYS scoped to the authenticated user (Req 18.7), and the
 * optional `subjectId` / `category` filters are applied additively — present iff a non-blank
 * value was supplied (Req 18.5, 18.6).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { buildMistakeWhere } from './filter';
import { MISTAKE_CATEGORIES, type MistakeCategoryValue } from './mistakeValidation';

/** subjectId choices: concrete ids, blank/whitespace (omitted), and null/undefined. */
const SUBJECT_CHOICES: Array<string | null | undefined> = [
    'sub-physics',
    'sub-chem',
    '   ',
    '',
    null,
    undefined,
];

/** category choices: the four valid values plus the "no filter" sentinels. */
const CATEGORY_CHOICES: Array<MistakeCategoryValue | null | undefined> = [
    ...MISTAKE_CATEGORIES,
    null,
    undefined,
];

describe('buildMistakeWhere filtering properties', () => {
    // Feature: jee-neet-study-app, Property 37: For any subject or category filter, every
    // returned mistake-journal entry matches the requested subject or category respectively.
    it('Property 37: where is always user-scoped with additive subject/category filters (Req 18.5, 18.6)', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1 }).filter((s) => s.trim() !== ''),
                fc.constantFrom(...SUBJECT_CHOICES),
                fc.constantFrom(...CATEGORY_CHOICES),
                (userId, subjectId, category) => {
                    const where = buildMistakeWhere(userId, { subjectId, category });

                    // Always user-scoped (Req 18.7).
                    expect(where.userId).toBe(userId);

                    // subjectId applied iff a non-blank string was provided (Req 18.5).
                    if (typeof subjectId === 'string' && subjectId.trim() !== '') {
                        expect(where.subjectId).toBe(subjectId.trim());
                    } else {
                        expect(where.subjectId).toBeUndefined();
                    }

                    // category applied iff a non-null value was provided (Req 18.6).
                    if (category != null) {
                        expect(where.category).toBe(category);
                    } else {
                        expect(where.category).toBeUndefined();
                    }
                },
            ),
        );
    });
});
