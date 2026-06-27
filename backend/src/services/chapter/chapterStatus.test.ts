/**
 * Unit tests for the pure chapter status lifecycle logic (task 5.1; Req 12.1, 12.2).
 *
 * DB- and framework-independent example/edge-case tests for the transition decision logic
 * only. The numbered property test for transition ordering (Property 26, task 5.5) is a
 * separate task and is not implemented here.
 */
import type { ChapterStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
    CHAPTER_STATUS_ORDER,
    chapterStatusRank,
    isChapterStatus,
    isValidStatusTransition,
} from './chapterStatus';

describe('CHAPTER_STATUS_ORDER', () => {
    it('lists the four lifecycle states in ascending order', () => {
        expect(CHAPTER_STATUS_ORDER).toEqual([
            'NOT_STARTED',
            'IN_PROGRESS',
            'DONE',
            'REVISED',
        ]);
    });
});

describe('isChapterStatus', () => {
    it('accepts every known lifecycle value', () => {
        for (const status of CHAPTER_STATUS_ORDER) {
            expect(isChapterStatus(status)).toBe(true);
        }
    });

    it('rejects unknown / malformed values', () => {
        for (const value of ['done', 'COMPLETE', '', null, undefined, 3, {}]) {
            expect(isChapterStatus(value)).toBe(false);
        }
    });
});

describe('chapterStatusRank', () => {
    it('returns the ascending ordinal of each status', () => {
        expect(chapterStatusRank('NOT_STARTED')).toBe(0);
        expect(chapterStatusRank('IN_PROGRESS')).toBe(1);
        expect(chapterStatusRank('DONE')).toBe(2);
        expect(chapterStatusRank('REVISED')).toBe(3);
    });
});

describe('isValidStatusTransition', () => {
    it('allows adjacent forward steps (Req 12.2)', () => {
        expect(isValidStatusTransition('NOT_STARTED', 'IN_PROGRESS')).toBe(true);
        expect(isValidStatusTransition('IN_PROGRESS', 'DONE')).toBe(true);
        expect(isValidStatusTransition('DONE', 'REVISED')).toBe(true);
    });

    it('allows forward skips over intermediate states (Req 12.2)', () => {
        expect(isValidStatusTransition('NOT_STARTED', 'DONE')).toBe(true);
        expect(isValidStatusTransition('NOT_STARTED', 'REVISED')).toBe(true);
        expect(isValidStatusTransition('IN_PROGRESS', 'REVISED')).toBe(true);
    });

    it('rejects every backward transition (Req 12.2)', () => {
        expect(isValidStatusTransition('IN_PROGRESS', 'NOT_STARTED')).toBe(false);
        expect(isValidStatusTransition('DONE', 'IN_PROGRESS')).toBe(false);
        expect(isValidStatusTransition('REVISED', 'DONE')).toBe(false);
        expect(isValidStatusTransition('REVISED', 'NOT_STARTED')).toBe(false);
    });

    it('rejects same-state no-op transitions', () => {
        for (const status of CHAPTER_STATUS_ORDER) {
            expect(isValidStatusTransition(status, status)).toBe(false);
        }
    });

    it('rejects transitions involving an unknown status value', () => {
        expect(isValidStatusTransition('BOGUS' as ChapterStatus, 'DONE')).toBe(false);
        expect(isValidStatusTransition('NOT_STARTED', 'BOGUS' as ChapterStatus)).toBe(false);
    });

    it('treats the lifecycle boundaries correctly', () => {
        // The lowest state can move to the highest (full forward skip)...
        expect(isValidStatusTransition('NOT_STARTED', 'REVISED')).toBe(true);
        // ...but the highest state can never move anywhere.
        for (const status of CHAPTER_STATUS_ORDER) {
            expect(isValidStatusTransition('REVISED', status)).toBe(false);
        }
    });
});
