import type { AuthContext } from '@/lib/auth';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { clarifyConceptWithProvider, liveProviderConfigured, type LiveConceptClarification } from '@/services/ai/liveProvider';

type ConceptMode = 'EXPLAIN' | 'SIMPLIFY' | 'ANALOGY' | 'QUIZ';
interface Module extends LiveConceptClarification { aliases: RegExp }

const MODULES: readonly Module[] = [
    {
        aliases: /fundamental rights?|article 32|constitution/i,
        explanation: 'Fundamental Rights are constitutionally protected freedoms in Part III of the Indian Constitution. They limit state power and provide remedies when protected rights are violated.',
        keyPoints: ['They are enforceable through courts.', 'Some rights apply only to citizens; others apply to every person.', 'Reasonable restrictions may apply where the Constitution permits them.', 'Article 32 provides a remedy before the Supreme Court.'],
        analogy: 'Think of them as enforceable guardrails: government action must stay inside them, and courts can correct a breach.',
        commonMisconception: 'Fundamental Rights are not absolute in every situation; the Constitution permits defined restrictions and exceptions.',
        quiz: { question: 'Which feature most clearly distinguishes a Fundamental Right from a general policy goal?', options: ['It is mentioned in a speech', 'It is enforceable through constitutional remedies', 'It applies only during elections', 'It cannot have any restriction'], correctOption: 1, hint: 'Focus on what a citizen can ask a court to enforce.', explanation: 'Justiciability and constitutional remedies make Fundamental Rights enforceable.' },
    },
    {
        aliases: /inflation|consumer price|cpi/i,
        explanation: 'Inflation is a sustained rise in the general price level, which reduces the purchasing power of money. A rise in one product alone is not necessarily economy-wide inflation.',
        keyPoints: ['Inflation concerns a basket or broad price level.', 'Purchasing power falls when income does not keep pace.', 'Demand, supply costs and expectations can all contribute.', 'Different price indices measure different baskets.'],
        analogy: 'If the same wallet buys fewer items from the usual basket over time, its purchasing power has fallen.',
        commonMisconception: 'A one-time rise in the price of a single commodity is not automatically sustained general inflation.',
        quiz: { question: 'Which situation best describes inflation?', options: ['Only tomato prices rise for one week', 'Most prices fall over a year', 'The general price level rises persistently', 'A company changes its logo'], correctOption: 2, hint: 'Look for breadth and persistence.', explanation: 'Inflation refers to a sustained increase in the general price level.' },
    },
    {
        aliases: /monsoon/i,
        explanation: 'The Indian monsoon is a seasonal reorganisation of winds associated with differential heating, pressure patterns, moisture transport and large-scale atmospheric circulation.',
        keyPoints: ['Land-sea heating contrast contributes to pressure differences.', 'Moisture-bearing winds support rainfall.', 'Topography redistributes rainfall.', 'Timing and strength vary from year to year.'],
        analogy: 'It is a seasonal circulation system whose route is reshaped by pressure and mountains, not one giant rain cloud.',
        commonMisconception: 'The monsoon is not caused by one factor alone; ocean-atmosphere interactions also matter.',
        quiz: { question: 'Why does topography matter to monsoon rainfall?', options: ['It changes Earth’s orbit', 'It lifts and redirects moist air', 'It stops all winds', 'It removes humidity from oceans'], correctOption: 1, hint: 'Think about air being forced upward.', explanation: 'Relief can force moist air to rise, cool and condense, while creating rain-shadow regions.' },
    },
    {
        aliases: /syllogism/i,
        explanation: 'A syllogism tests whether a conclusion must follow from the given statements. The task is about logical necessity, not real-world plausibility.',
        keyPoints: ['Treat statements as the complete temporary universe.', 'A conclusion must hold in every valid arrangement.', 'Possibility and certainty are different.', 'Venn diagrams expose invalid overlap assumptions.'],
        analogy: 'It is like checking whether every legal arrangement of labelled boxes forces the same result.',
        commonMisconception: 'Do not add outside knowledge or assume two groups overlap unless the statements require it.',
        quiz: { question: 'All A are B. Some B are C. What must follow?', options: ['Some A are C', 'No A is C', 'All C are A', 'None of these is guaranteed'], correctOption: 3, hint: 'Can the “some B” members sit outside A?', explanation: 'The B members that are C need not be A, so no listed relationship between A and C is guaranteed.' },
    },
    {
        aliases: /percentage|percent/i,
        explanation: 'A percentage expresses a quantity per hundred. Percentage change compares the difference with the original value, not the final value.',
        keyPoints: ['x% means x per 100.', 'Percentage change = change ÷ original × 100.', 'Successive changes are multiplicative.', 'Equal percentage rise and fall do not cancel.'],
        analogy: 'Treat 100 equal boxes as the whole; a percentage tells you how many boxes are represented.',
        commonMisconception: 'A 20% rise followed by a 20% fall produces a net 4% fall, not zero change.',
        quiz: { question: 'A value rises from 100 to 120, then falls by 20%. What is the final value?', options: ['100', '96', '104', '80'], correctOption: 1, hint: 'The decrease is 20% of 120.', explanation: 'Twenty percent of 120 is 24, so the final value is 96.' },
    },
];

function clean(value: unknown, max: number): string { return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''; }
function fallback(concept: string, mode: ConceptMode): LiveConceptClarification {
    const lesson = MODULES.find((item) => item.aliases.test(concept));
    const content: LiveConceptClarification = lesson ?? {
        explanation: `${concept} is not in the offline concept catalog yet. Use the active-recall sequence below with a trusted syllabus source; connect the AI provider for a grounded custom explanation.`,
        keyPoints: ['Write the definition in one sentence.', 'List the mechanism, rule or steps.', 'Add one example and one exception.', 'Connect it to one previous-year question.'],
        analogy: 'Build the concept like a four-part bridge: definition, mechanism, example and exception.',
        commonMisconception: 'Do not memorise an unsupported explanation generated without a source.',
        quiz: { question: `Which step best verifies that you understand ${concept}?`, options: ['Reread it repeatedly', 'Explain it without notes and solve a related question', 'Highlight every sentence', 'Copy the definition five times'], correctOption: 1, hint: 'Choose retrieval plus application.', explanation: 'Retrieval plus application reveals gaps more reliably than passive rereading.' },
    };
    if (mode === 'SIMPLIFY') return { ...content, explanation: `In simple terms: ${content.explanation}`, keyPoints: content.keyPoints.slice(0, 3) };
    if (mode === 'ANALOGY') return { ...content, explanation: `${content.analogy} In the actual concept: ${content.explanation}` };
    if (mode === 'QUIZ') return { ...content, explanation: `Test your understanding first. After answering, compare your reasoning with the explanation.` };
    return content;
}

export async function createConceptClarificationHandler(request: Request, _auth: AuthContext): Promise<Response> {
    let body: Record<string, unknown> | null = null;
    try { const value = await request.json(); body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { body = null; }
    const concept = clean(body?.concept, 160); const confusion = clean(body?.confusion, 1000);
    const level = clean(body?.level, 20) || 'BEGINNER'; const language = clean(body?.language, 40) || 'English';
    const mode = (clean(body?.mode, 20) || 'EXPLAIN') as ConceptMode;
    if (!concept) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'A concept is required.');
    if (!['EXPLAIN', 'SIMPLIFY', 'ANALOGY', 'QUIZ'].includes(mode)) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Unsupported clarification mode.');
    if (liveProviderConfigured()) {
        try { return Response.json({ concept, mode, source: 'AI', content: await clarifyConceptWithProvider({ concept, confusion, level, language, mode }) }); }
        catch { /* use safe curated/guided fallback */ }
    }
    return Response.json({ concept, mode, source: 'CURATED_OR_GUIDED', content: fallback(concept, mode) });
}
