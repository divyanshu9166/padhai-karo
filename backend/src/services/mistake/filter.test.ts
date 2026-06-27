import { describe, expect, it } from 'vitest';

/**
 * Example (DB-independent) tests for the pure Mistake Journal filter-criteria builder
 * (task 14.1, Req 18.5, 18.6, 18.7).
 *
 * Covers the where-clause building the task specifies: always user-scoped (Req 18.7), with
 * subject and/or category applied only when provided (Req 18.5/18.6). The numbered property
 * test (Property 37) is task 14.4.
 *
 * Validates: Requirements 18.5, 18.6, 18.7
 */

import { MISTAKE_LIST_ORDER_BY, buildMistakeWhere } from './filter';

describe('buildMistakeWhere', () => {
    it('always scopes to the user with no filters (Req 18.7)', () => {
        expect(buildMistakeWhere('user-1')).toEqual({ userId: 'user-1' });
        expect(buildMistakeWhere('user-1', {})).toEqual({ userId: 'user-1' });
    });

    it('adds a subject filter when provided (Req 18.5)', () => {
        expect(buildMistakeWhere('user-1', { subjectId: 'sub-physics' })).toEqual({
            userId: 'user-1',
            subjectId: 'sub-physics',
        });
    });

    it('adds a category filter when provided (Req 18.6)', () => {
        expect(buildMistakeWhere('user-1', { category: 'CONCEPT_GAP' })).toEqual({
            userId: 'user-1',
            category: 'CONCEPT_GAP',
        });
    });

    it('combines subject and category filters', () => {
        expect(
            buildMistakeWhere('user-1', { subjectId: 'sub-1', category: 'TIME_PRESSURE' }),
        ).toEqual({ userId: 'user-1', subjectId: 'sub-1', category: 'TIME_PRESSURE' });
    });

    it('omits blank/nullish filters', () => {
        expect(
            buildMistakeWhere('user-1', { subjectId: '   ', category: null }),
        ).toEqual({ userId: 'user-1' });
        expect(buildMistakeWhere('user-1', { subjectId: null })).toEqual({ userId: 'user-1' });
    });

    it('trims a provided subjectId', () => {
        expect(buildMistakeWhere('user-1', { subjectId: '  sub-2  ' })).toEqual({
            userId: 'user-1',
            subjectId: 'sub-2',
        });
    });
});

describe('MISTAKE_LIST_ORDER_BY', () => {
    it('orders newest-first with id as a stable tiebreaker', () => {
        expect(MISTAKE_LIST_ORDER_BY).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
    });
});
