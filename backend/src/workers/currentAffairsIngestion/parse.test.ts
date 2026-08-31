import { describe, expect, it } from 'vitest';
import { parseFeedPayload } from './parse';

describe('current affairs feed parsing', () => {
    it('parses JSON items and normalizes markup', () => {
        const items = parseFeedPayload({ items: [{ title: ' Policy ', description: '<b>Useful</b>' }] }, 'UPSC source', 'https://example.test', 'UPSC_CSE');
        expect(items[0]).toMatchObject({ title: 'Policy', summary: 'Useful', examProgram: 'UPSC_CSE' });
    });

    it('parses a minimal RSS item', () => {
        const items = parseFeedPayload('<item><title>Scheme</title><description>Details</description></item>', 'SSC source', 'https://example.test', 'SSC_CGL');
        expect(items[0]?.title).toBe('Scheme');
    });
});
