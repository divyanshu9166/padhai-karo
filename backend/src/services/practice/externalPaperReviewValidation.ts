/** Input boundary for a self-reported external paper review. */

export const EXTERNAL_PAPER_MISTAKE_TAGS = [
    'CONCEPT_GAP',
    'SILLY_MISTAKE',
    'TIME_PRESSURE',
    'REVISION_GAP',
    'UNATTEMPTED',
] as const;

export type ExternalPaperMistakeTag = (typeof EXTERNAL_PAPER_MISTAKE_TAGS)[number];

export interface PaperBreakdownInput {
    label: string;
    obtainedScore: number;
    maxScore: number;
}

export interface ExternalPaperReviewInput {
    title: string;
    sourceName?: string;
    testDate: string;
    obtainedScore: number;
    maxScore: number;
    breakdown?: PaperBreakdownInput[];
    mistakeTags?: ExternalPaperMistakeTag[];
    selfNotes?: string;
    documentId?: string;
}

export interface ValidExternalPaperReviewInput {
    title: string;
    sourceName: string | null;
    testDate: Date;
    obtainedScore: number;
    maxScore: number;
    breakdown: PaperBreakdownInput[];
    mistakeTags: ExternalPaperMistakeTag[];
    selfNotes: string | null;
    documentId: string | null;
}

export type ValidationResult =
    | { ok: true; value: ValidExternalPaperReviewInput }
    | { ok: false; message: string; details?: unknown };

function text(value: unknown, limit: number): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().replace(/\s+/g, ' ');
    return normalized.length > 0 && normalized.length <= limit ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validScore(obtainedScore: unknown, maxScore: unknown): obtainedScore is number {
    return typeof obtainedScore === 'number'
        && typeof maxScore === 'number'
        && Number.isFinite(obtainedScore)
        && Number.isFinite(maxScore)
        && maxScore > 0
        && obtainedScore >= 0
        && obtainedScore <= maxScore;
}

/** Validates and normalizes only the data needed for an honest study review. */
export function validateExternalPaperReviewInput(input: unknown): ValidationResult {
    if (!isRecord(input)) return { ok: false, message: 'Request body must be a JSON object.' };

    const title = text(input.title, 140);
    if (!title) return { ok: false, message: 'Add a paper title between 1 and 140 characters.', details: { field: 'title' } };

    if (!validScore(input.obtainedScore, input.maxScore)) {
        return { ok: false, message: 'Provide a score between 0 and the maximum score.', details: { fields: ['obtainedScore', 'maxScore'] } };
    }

    if (typeof input.testDate !== 'string') return { ok: false, message: 'Provide a valid test date.', details: { field: 'testDate' } };
    const testDate = new Date(input.testDate);
    if (Number.isNaN(testDate.getTime()) || testDate.getTime() > Date.now()) {
        return { ok: false, message: 'Test date must be valid and cannot be in the future.', details: { field: 'testDate' } };
    }

    const sourceName = input.sourceName === undefined ? null : text(input.sourceName, 120);
    if (input.sourceName !== undefined && !sourceName) return { ok: false, message: 'Source name must be 1 to 120 characters.', details: { field: 'sourceName' } };

    const rawBreakdown = input.breakdown === undefined ? [] : input.breakdown;
    if (!Array.isArray(rawBreakdown) || rawBreakdown.length > 12) return { ok: false, message: 'Add up to 12 section score entries.', details: { field: 'breakdown' } };
    const breakdown: PaperBreakdownInput[] = [];
    for (const item of rawBreakdown) {
        if (!isRecord(item) || !text(item.label, 80) || !validScore(item.obtainedScore, item.maxScore)) {
            return { ok: false, message: 'Each section needs a label and a score between 0 and its maximum.', details: { field: 'breakdown' } };
        }
        breakdown.push({ label: text(item.label, 80)!, obtainedScore: item.obtainedScore, maxScore: item.maxScore as number });
    }

    const rawTags = input.mistakeTags === undefined ? [] : input.mistakeTags;
    if (!Array.isArray(rawTags) || rawTags.some((tag) => typeof tag !== 'string' || !EXTERNAL_PAPER_MISTAKE_TAGS.includes(tag as ExternalPaperMistakeTag))) {
        return { ok: false, message: 'One or more mistake tags are invalid.', details: { field: 'mistakeTags' } };
    }
    const mistakeTags = [...new Set(rawTags as ExternalPaperMistakeTag[])];

    const selfNotes = input.selfNotes === undefined ? null : text(input.selfNotes, 3000);
    if (input.selfNotes !== undefined && !selfNotes) return { ok: false, message: 'Reflection must be between 1 and 3,000 characters.', details: { field: 'selfNotes' } };
    const documentId = input.documentId === undefined ? null : text(input.documentId, 120);
    if (input.documentId !== undefined && !documentId) return { ok: false, message: 'Attached document reference is invalid.', details: { field: 'documentId' } };

    return { ok: true, value: { title, sourceName, testDate, obtainedScore: input.obtainedScore, maxScore: input.maxScore as number, breakdown, mistakeTags, selfNotes, documentId } };
}
