import { beforeEach, describe, expect, it, vi } from 'vitest';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { answerWritingAttempt: { create } } }));
import { createAnswerWritingHandler } from './answerWritingService';

describe('answer-writing rubric', () => {
    beforeEach(() => { create.mockReset(); create.mockImplementation(async ({ data }) => ({ id: 'a1', ...data })); });
    it('returns criterion-level feedback and a factual-verification caution', async () => {
        const request = new Request('http://local', { method: 'POST', body: JSON.stringify({ prompt: 'Discuss the impact of inflation and suggest measures.', answerText: 'Inflation means a sustained rise in prices. Impact on households is unequal. However, policy must balance growth and price stability. For example, targeted support can protect vulnerable groups. In conclusion, monetary and supply-side measures should work together.' }) });
        const response = await createAnswerWritingHandler(request, { user: { id: 'u1' } } as never);
        const payload = await response.json() as any;
        expect(response.status).toBe(201);
        expect(payload.attempt.feedback.criteria).toHaveProperty('relevance');
        expect(payload.attempt.feedback.factualCautions[0]).toMatch(/verify factual accuracy/i);
    });
});
