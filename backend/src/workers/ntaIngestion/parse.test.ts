import { describe, expect, it } from 'vitest';

import { parseAndValidate } from './parse';
import { computeDedupeHash } from './dedupe';
import type { RawNtaItem } from './types';

function validRaw(overrides: Partial<RawNtaItem> = {}): RawNtaItem {
    return {
        examScope: 'JEE_MAIN',
        title: 'JEE Main 2026 admit card released',
        body: 'Download the admit card from the official portal.',
        publishedAt: '2025-03-01T08:00:00.000Z',
        ...overrides,
    };
}

describe('parseAndValidate', () => {
    it('accepts a well-formed item and returns sanitized, fingerprinted output', () => {
        const result = parseAndValidate(validRaw({ body: '<p>Download <b>now</b></p>' }));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.examScope).toBe('JEE_MAIN');
        expect(result.value.body).toBe('Download now');
        expect(result.value.title).not.toMatch(/[<>]/);
        expect(result.value.publishedAt).toBeInstanceOf(Date);
        expect(result.value.affectsExamDate).toBe(false);
        expect(result.value.newExamDate).toBeNull();
        expect(result.value.dedupeHash).toMatch(/^[0-9a-f]{64}$/);
        // The hash is computed over the SANITIZED fields.
        expect(result.value.dedupeHash).toBe(
            computeDedupeHash({
                examScope: 'JEE_MAIN',
                title: result.value.title,
                body: result.value.body,
                publishedAt: result.value.publishedAt,
            }),
        );
    });

    it('accepts a Date object for publishedAt', () => {
        const result = parseAndValidate(validRaw({ publishedAt: new Date('2025-03-01T08:00:00Z') }));
        expect(result.ok).toBe(true);
    });

    it('captures a valid exam-date change', () => {
        const result = parseAndValidate(
            validRaw({ affectsExamDate: true, newExamDate: '2026-04-12T00:00:00.000Z' }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.affectsExamDate).toBe(true);
        expect(result.value.newExamDate?.toISOString()).toBe('2026-04-12T00:00:00.000Z');
    });

    it.each([
        ['not an object', 42 as unknown as RawNtaItem],
        ['null item', null as unknown as RawNtaItem],
        ['unknown examScope', validRaw({ examScope: 'SAT' })],
        ['missing examScope', validRaw({ examScope: undefined })],
        ['non-string title', validRaw({ title: 123 })],
        ['non-string body', validRaw({ body: {} })],
        ['title empty after sanitization', validRaw({ title: '<br/>' })],
        ['body empty after sanitization', validRaw({ body: '   ' })],
        ['invalid publishedAt', validRaw({ publishedAt: 'not-a-date' })],
        ['missing publishedAt', validRaw({ publishedAt: undefined })],
        ['affectsExamDate true but no newExamDate', validRaw({ affectsExamDate: true })],
        [
            'affectsExamDate true but invalid newExamDate',
            validRaw({ affectsExamDate: true, newExamDate: 'soon' }),
        ],
    ])('rejects a malformed item: %s', (_label, raw) => {
        const result = parseAndValidate(raw);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(typeof result.reason).toBe('string');
        expect(result.reason.length).toBeGreaterThan(0);
    });

    it('treats a missing/false affectsExamDate as a non-exam-date item', () => {
        const result = parseAndValidate(validRaw({ affectsExamDate: false, newExamDate: 'soon' }));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.affectsExamDate).toBe(false);
        expect(result.value.newExamDate).toBeNull();
    });
});
