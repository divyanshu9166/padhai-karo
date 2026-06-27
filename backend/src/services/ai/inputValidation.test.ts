import { describe, expect, it } from 'vitest';

import { validateSummaryInput } from './inputValidation';

/**
 * Pure (DB-independent) tests for AI notes input validation (task 16.1).
 *
 * Validates: Requirements 8.1, 8.2, 8.3
 */
describe('validateSummaryInput', () => {
    it('accepts non-empty TEXT input (Req 8.1)', () => {
        const result = validateSummaryInput({ inputType: 'TEXT', text: 'Newton laws' });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toEqual({ inputType: 'TEXT', text: 'Newton laws' });
        }
    });

    it('accepts PHOTO input with a non-empty imageUploadId, trimming it (Req 8.2)', () => {
        const result = validateSummaryInput({ inputType: 'PHOTO', imageUploadId: '  img-1 ' });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toEqual({ inputType: 'PHOTO', imageUploadId: 'img-1' });
        }
    });

    it.each(['', '   ', '\t\n  '])(
        'rejects empty/whitespace-only TEXT %j with EMPTY_INPUT (Req 8.3)',
        (text) => {
            const result = validateSummaryInput({ inputType: 'TEXT', text });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.code).toBe('EMPTY_INPUT');
            }
        },
    );

    it('rejects TEXT with a non-string text field', () => {
        const result = validateSummaryInput({ inputType: 'TEXT', text: 123 });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.code).toBe('EMPTY_INPUT');
        }
    });

    it('rejects PHOTO with a missing/blank imageUploadId', () => {
        const result = validateSummaryInput({ inputType: 'PHOTO', imageUploadId: '  ' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.code).toBe('VALIDATION_ERROR');
        }
    });

    it('rejects an unknown inputType', () => {
        const result = validateSummaryInput({ inputType: 'AUDIO' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.code).toBe('VALIDATION_ERROR');
        }
    });

    it.each([null, undefined, 'a string', 42, []])(
        'rejects a non-object body %j',
        (body) => {
            const result = validateSummaryInput(body);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.code).toBe('VALIDATION_ERROR');
            }
        },
    );
});
