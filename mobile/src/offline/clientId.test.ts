import { describe, expect, it } from 'vitest';

import { generateClientId } from './clientId';

/** RFC-4122 v4 shape (the variant nibble is one of 8/9/a/b). */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('generateClientId', () => {
    it('produces a UUID-shaped idempotency key', () => {
        expect(generateClientId()).toMatch(UUID_V4);
    });

    it('produces distinct ids across many calls (uniqueness, Req 21.3)', () => {
        const ids = new Set<string>();
        for (let i = 0; i < 1000; i += 1) {
            ids.add(generateClientId());
        }
        expect(ids.size).toBe(1000);
    });
});
