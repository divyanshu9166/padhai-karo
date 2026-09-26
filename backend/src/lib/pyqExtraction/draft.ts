/**
 * The reviewable draft that sits between automatic extraction and the database importer.
 *
 * `buildDraft` merges parsed questions with the machine-read answer key. `finalizeDraft` is
 * the gate a reviewed draft must pass before it becomes import-ready: every question approved
 * by a person, four non-empty options, an answer for every scored question, dropped questions
 * explicitly confirmed, and source checksums unchanged since download.
 */
import type { InterpretedKey, KeyCell } from './answerKey';
import type { ExtractionResult, QuestionIssue, SourceRegion } from './questions';

export interface OfficialSource {
    id: string;
    program: 'UPSC_CSE' | 'SSC_CGL';
    stage: string;
    year: number;
    paperKey: string;
    sourceName: string;
    sourcePageUrl: string;
    downloadUrl?: string;
    answerKeyUrl?: string;
    /** Booklet series printed on the downloaded paper; its answer-key page is used. */
    series?: string;
    /** Subject the questions are filed under (a key from src/lib/exams). */
    subjectId?: string;
    /** 1-based answer-key page override when the series cell cannot be read. */
    keyPage?: number;
    requiresFinalKeyReview?: boolean;
    notes?: string;
}

export interface Receipt {
    sha256: string;
    answerKeySha256?: string;
    answerKeyPath?: string;
    downloadUrl?: string;
    answerKeyUrl?: string;
}

export type AnswerStatus = 'AUTO' | 'NEEDS_REVIEW' | 'DROPPED' | 'MISSING';
export type ReviewStatus = 'PENDING' | 'APPROVED';

export interface DraftQuestion {
    questionRef: string;
    preamble?: string;
    questionText: string;
    options: string[];
    /** Option index 0..3, or null for dropped/unknown. */
    answer: number | null;
    answerStatus: AnswerStatus;
    /** The classifier's best reading when the answer needs review ("A".."D", "X", "?"). */
    answerGuess?: string;
    issues: Array<QuestionIssue | 'NOT_FOUND_IN_SCAN'>;
    regions: SourceRegion[];
    keyCell?: { x: number; y: number; w: number; h: number };
    reviewStatus: ReviewStatus;
    reviewerNote?: string;
}

export interface PyqDraft {
    draftVersion: 1;
    sourceId: string;
    program: OfficialSource['program'];
    stage: string;
    year: number;
    paperKey: string;
    subjectId: string;
    series: string;
    durationMin: number;
    expectedQuestions: number;
    sourceName: string;
    sourceUrl: string;
    answerKeyUrl: string;
    questionPaperSha256: string;
    answerKeySha256: string;
    extractedAt: string;
    pageImages: string[];
    keyImage: string;
    questions: DraftQuestion[];
}

export interface BuildDraftInput {
    source: OfficialSource;
    receipt: Receipt;
    definition: { key: string; questionCount: number; durationMin: number };
    series: string;
    extraction: ExtractionResult;
    key: InterpretedKey;
    keyCells: KeyCell[];
    pageImages: string[];
    keyImage: string;
    now?: Date;
}

/** The subject a paper's questions belong to, e.g. UPSC-CSE-PRELIMS-GS1 → UPSC-CSE-GS1. */
export function defaultSubjectId(paperDefinitionKey: string): string | null {
    const map: Record<string, string> = { 'UPSC-CSE-PRELIMS-GS1': 'UPSC-CSE-GS1', 'UPSC-CSE-PRELIMS-CSAT': 'UPSC-CSE-CSAT' };
    return map[paperDefinitionKey] ?? null;
}

export function buildDraft(input: BuildDraftInput): PyqDraft {
    const { source, receipt, definition, extraction, key } = input;
    const subjectId = source.subjectId ?? defaultSubjectId(definition.key);
    if (!subjectId) throw new Error(`Set "subjectId" for ${source.id}: no default subject for ${definition.key}.`);
    if (!receipt.answerKeySha256) throw new Error(`The receipt for ${source.id} has no answer-key checksum.`);
    const byNumber = new Map(extraction.questions.map((q) => [q.number, q]));
    const reviewByRef = new Map(key.review.map((r) => [r.questionRef, r]));
    const cellByRef = new Map(input.keyCells.map((c) => [c.id, c]));
    const questions: DraftQuestion[] = [];
    for (let n = 1; n <= definition.questionCount; n += 1) {
        const ref = String(n);
        const parsed = byNumber.get(n);
        const cell = cellByRef.get(ref);
        const review = reviewByRef.get(ref);
        const dropped = key.dropped.includes(ref);
        const answer = key.answers[ref];
        questions.push({
            questionRef: ref,
            ...(parsed?.preamble ? { preamble: parsed.preamble } : {}),
            questionText: parsed?.stem ?? '',
            options: parsed ? [0, 1, 2, 3].map((i) => parsed.options[i] ?? '') : ['', '', '', ''],
            answer: dropped || answer === undefined ? null : answer,
            answerStatus: dropped ? 'DROPPED' : answer !== undefined ? 'AUTO' : review ? 'NEEDS_REVIEW' : 'MISSING',
            ...(review ? { answerGuess: review.guess } : {}),
            issues: parsed ? parsed.issues : ['NOT_FOUND_IN_SCAN'],
            regions: parsed?.regions ?? [],
            ...(cell ? { keyCell: { x: cell.x, y: cell.y, w: cell.w, h: cell.h } } : {}),
            reviewStatus: 'PENDING',
        });
    }
    return {
        draftVersion: 1,
        sourceId: source.id,
        program: source.program,
        stage: source.stage,
        year: source.year,
        paperKey: source.paperKey,
        subjectId,
        series: input.series,
        durationMin: definition.durationMin,
        expectedQuestions: definition.questionCount,
        sourceName: source.sourceName,
        sourceUrl: receipt.downloadUrl ?? source.downloadUrl ?? source.sourcePageUrl,
        answerKeyUrl: receipt.answerKeyUrl ?? source.answerKeyUrl ?? source.sourcePageUrl,
        questionPaperSha256: receipt.sha256,
        answerKeySha256: receipt.answerKeySha256,
        extractedAt: (input.now ?? new Date()).toISOString(),
        pageImages: input.pageImages,
        keyImage: input.keyImage,
        questions,
    };
}

/** Import-ready shape consumed by prisma/import-official-pyq.ts. */
export interface ImportFile {
    program: PyqDraft['program'];
    stage: string;
    year: number;
    paperKey: string;
    durationMin: number;
    sourceName: string;
    sourceUrl: string;
    answerKeyUrl: string;
    reviewedAt: string;
    questionPaperSha256: string;
    answerKeySha256: string;
    answerKey: Record<string, number>;
    droppedQuestions: string[];
    questions: Array<{ questionRef: string; subjectId: string; questionText: string; options: string[] }>;
}

export type FinalizeResult = { ok: true; file: ImportFile } | { ok: false; problems: string[] };

/**
 * Validate a reviewed draft. `checksums` are the current SHA-256 values of the source PDFs; they
 * must match what the draft was extracted from, so a reviewed file can never be attached to a
 * different download.
 */
export function finalizeDraft(draft: PyqDraft, checksums: { questionPaper: string; answerKey: string }, now: Date = new Date()): FinalizeResult {
    const problems: string[] = [];
    if (draft.draftVersion !== 1) problems.push('Unsupported draft version.');
    if (draft.questionPaperSha256 !== checksums.questionPaper) problems.push('The question-paper PDF changed since extraction; re-run pyq:extract.');
    if (draft.answerKeySha256 !== checksums.answerKey) problems.push('The answer-key PDF changed since extraction; re-run pyq:extract.');
    if (draft.questions.length !== draft.expectedQuestions) problems.push(`Expected ${draft.expectedQuestions} questions, the draft has ${draft.questions.length}.`);
    const refs = draft.questions.map((q) => q.questionRef);
    if (new Set(refs).size !== refs.length) problems.push('Question references must be unique.');

    const answerKey: Record<string, number> = {};
    const droppedQuestions: string[] = [];
    const questions: ImportFile['questions'] = [];
    for (const q of draft.questions) {
        const label = `Q${q.questionRef}`;
        if (q.reviewStatus !== 'APPROVED') { problems.push(`${label} has not been approved by a reviewer.`); continue; }
        if (q.answerStatus === 'DROPPED') {
            if (q.answer !== null) problems.push(`${label} is marked dropped but still has an answer.`);
            droppedQuestions.push(q.questionRef);
            continue;
        }
        const text = q.questionText.trim();
        const options = q.options.map((option) => option.trim());
        if (text.length < 10) problems.push(`${label} question text is empty or too short.`);
        if (options.length !== 4 || options.some((option) => option.length === 0)) problems.push(`${label} needs exactly four non-empty options.`);
        const distinctExact = new Set(options).size === options.length;
        const distinctLower = new Set(options.map((o) => o.toLowerCase())).size === options.length;
        if (!distinctExact) {
            problems.push(`${label} has duplicate options.`);
        } else if (!distinctLower) {
            const allSameLower = new Set(options.map((o) => o.toLowerCase())).size === 1;
            if (!allSameLower) {
                problems.push(`${label} has duplicate options.`);
            }
        }
        if (q.answer === null || !Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) problems.push(`${label} needs a final answer (A–D) confirmed against the official key.`);
        if (problems.some((p) => p.startsWith(`${label} `))) continue;
        answerKey[q.questionRef] = q.answer!;
        questions.push({ questionRef: q.questionRef, subjectId: draft.subjectId, questionText: q.preamble?.trim() ? `${q.preamble.trim()}\n\n${text}` : text, options });
    }
    if (problems.length > 0) return { ok: false, problems };
    return {
        ok: true,
        file: {
            program: draft.program,
            stage: draft.stage,
            year: draft.year,
            paperKey: draft.paperKey,
            durationMin: draft.durationMin,
            sourceName: draft.sourceName,
            sourceUrl: draft.sourceUrl,
            answerKeyUrl: draft.answerKeyUrl,
            reviewedAt: now.toISOString(),
            questionPaperSha256: draft.questionPaperSha256,
            answerKeySha256: draft.answerKeySha256,
            answerKey,
            droppedQuestions,
            questions,
        },
    };
}
