import { describe, expect, it } from 'vitest';
import { analysePaperDocumentText } from './paperDocumentInsights';

describe('analysePaperDocumentText', () => {
    it('detects UPSC themes without claiming answer correctness', () => {
        const result = analysePaperDocumentText('1. The Constitution and Parliament govern fundamental rights. 2. Inflation and monetary policy affect the economy. 3. Biodiversity conservation protects an ecosystem.', 'UPSC_CSE');
        expect(result.source).toBe('EXTRACTED_TEXT');
        expect(result.detectedTopics.map((topic) => topic.label)).toContain('Polity and Governance');
        expect(result.limitation).toMatch(/cannot judge/i);
    });

    it('fails transparently on unreadable scans', () => {
        expect(analysePaperDocumentText('', 'SSC_CGL')).toMatchObject({ source: 'UNAVAILABLE', coverage: 'NONE' });
    });
});
