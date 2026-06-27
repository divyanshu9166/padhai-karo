import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ErrorCode, errorEnvelope, errorResponse } from './errorEnvelope';

describe('errorEnvelope', () => {
    it('builds the { error: { code, message } } shape without details when omitted', () => {
        const env = errorEnvelope(ErrorCode.VALIDATION_ERROR, 'bad input');
        expect(env).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'bad input' } });
        expect('details' in env.error).toBe(false);
    });

    it('includes details when provided', () => {
        const env = errorEnvelope(ErrorCode.WEAK_PASSWORD, 'too weak', { requirement: 'min length 8' });
        expect(env.error.details).toEqual({ requirement: 'min length 8' });
    });

    it('preserves a falsy details value (does not drop it)', () => {
        const env = errorEnvelope(ErrorCode.VALIDATION_ERROR, 'msg', null);
        expect('details' in env.error).toBe(true);
        expect(env.error.details).toBeNull();
    });

    // Sanity check that the fast-check harness is wired and runs the configured iterations.
    it('always produces the canonical envelope shape for arbitrary code/message', () => {
        fc.assert(
            fc.property(fc.string(), fc.string(), (code, message) => {
                const env = errorEnvelope(code, message);
                expect(Object.keys(env)).toEqual(['error']);
                expect(env.error.code).toBe(code);
                expect(env.error.message).toBe(message);
            }),
        );
    });
});

describe('errorResponse', () => {
    it('serializes the envelope as JSON with the given HTTP status', async () => {
        const res = errorResponse(409, ErrorCode.EMAIL_ALREADY_EXISTS, 'email taken');
        expect(res.status).toBe(409);
        expect(res.headers.get('content-type')).toContain('application/json');
        await expect(res.json()).resolves.toEqual({
            error: { code: 'EMAIL_ALREADY_EXISTS', message: 'email taken' },
        });
    });
});
