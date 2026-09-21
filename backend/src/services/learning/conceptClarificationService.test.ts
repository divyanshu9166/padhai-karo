import { describe, expect, it } from 'vitest';
import { createConceptClarificationHandler } from './conceptClarificationService';

const auth = { user: { id: 'user-1' } } as never;
describe('concept clarification', () => {
    it('returns a mastery check for a curated concept', async () => {
        const response = await createConceptClarificationHandler(new Request('http://local', { method: 'POST', body: JSON.stringify({ concept: 'inflation' }) }), auth);
        const payload = await response.json() as any;
        expect(response.status).toBe(200);
        expect(payload.content.quiz.options).toHaveLength(4);
        expect(payload.content.explanation).toMatch(/price level/i);
    });
    it('rejects an empty concept', async () => {
        const response = await createConceptClarificationHandler(new Request('http://local', { method: 'POST', body: '{}' }), auth);
        expect(response.status).toBe(422);
    });
    it('changes the teaching response when the learner requests an analogy', async () => {
        const response = await createConceptClarificationHandler(new Request('http://local', {
            method: 'POST', body: JSON.stringify({ concept: 'percentage', mode: 'ANALOGY' }),
        }), auth);
        const payload = await response.json() as any;
        expect(payload.mode).toBe('ANALOGY');
        expect(payload.content.explanation).toMatch(/100 equal boxes/i);
        expect(payload.content.quiz.options).toHaveLength(4);
    });
});
