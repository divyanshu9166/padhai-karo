import { describe, expect, it } from 'vitest';

import { AnswerKeyLayoutError, interpretKey, keyGridCells, seriesCell, seriesFromText } from './answerKey';
import { buildDraft, finalizeDraft, type BuildDraftInput, type PyqDraft } from './draft';
import { columnBoundary, detectBookletSeries, isLatinTextPage, pageRows, type OcrLine, type OcrPage } from './layout';
import { extractQuestions, normalizeOcrText } from './questions';
import { renderReviewPage } from './reviewPage';

const W = 1600;
const H = 2100;

/** One OCR line; `text` is split into words laid out left to right from x. */
function line(text: string, x: number, y: number): OcrLine {
    let cursor = x;
    const words = text.split(' ').map((word) => {
        const w = { text: word, x: cursor, y, w: word.length * 12, h: 22 };
        cursor += w.w + 10;
        return w;
    });
    return { text, words };
}

// Lower-case so the parser never mistakes filler for an unnumbered question start.
const FILLER = 'ordinary english words fill this line so the page reads like a real booklet page';

/** A two-column English page: questions as [number, rows...] blocks per column. */
function page(columns: Array<Array<{ number?: string; rows: string[]; gapBefore?: number }>>, extra: OcrLine[] = []): OcrPage {
    const lines: OcrLine[] = [];
    columns.forEach((blocks, column) => {
        const numberX = column === 0 ? 60 : 780;
        const bodyX = column === 0 ? 140 : 860;
        let y = 140;
        for (const block of blocks) {
            y += block.gapBefore ?? 0;
            if (block.number) lines.push(line(block.number, numberX, y));
            for (const row of block.rows) { lines.push(line(row, bodyX, y)); y += 40; }
            y += 50;
        }
    });
    // Enough ordinary text for the page to classify as English.
    for (let i = 0; i < 32; i += 1) lines.push(line(FILLER, 140, 1000 + i * 25));
    lines.push(...extra);
    return { image: 'p.jpg', width: W, height: H, lines };
}

const question = (stem: string, options: string[]): string[] => [stem, ...options.map((o, i) => `(${'abcd'[i]}) ${o}`)];
const hindi: OcrPage = { image: 'h.jpg', width: W, height: H, lines: [line('$77-111 :', 200, 300), line('g3•Tiqr', 900, 400)] };

describe('layout', () => {
    it('recognises English pages and ignores Hindi pages OCR-ed with the English engine', () => {
        expect(isLatinTextPage(page([[{ number: '1.', rows: question('Consider the following statements about rivers of India', ['One', 'Two', 'Three', 'Four']) }], []]))).toBe(true);
        expect(isLatinTextPage(hindi)).toBe(false);
    });

    it('puts the gutter just left of the right-column question numbers, not the indented list items', () => {
        const p = page([[], [{ number: '3.', rows: ['Consider the following :', '1. Pyroclastic debris', '2. Ash and dust'] }]], [line('1.', 842, 700), line('2.', 842, 740)]);
        expect(columnBoundary([p])).toBeLessThan(780);
        expect(columnBoundary([p])).toBeGreaterThan(700);
    });

    it('merges fragments that share a baseline and reads the left column before the right', () => {
        const p: OcrPage = { image: 'x', width: W, height: H, lines: [line('(a)', 860, 300), line('Only one', 930, 302), line('left column text', 140, 900)] };
        const rows = pageRows(p, 0, 760);
        expect(rows.map((r) => r.text)).toEqual(['left column text', '(a) Only one']);
    });
});

describe('detectBookletSeries', () => {
    const footers = (marks: string[]): OcrPage[] => marks.map((mark) => ({ image: 'x', width: W, height: H, lines: [line(`KSPC-P-GSPO ${mark}`, 70, 1900)] }));
    it('reads the series from page footers by clear majority', () => {
        expect(detectBookletSeries(footers(['(2-A)', '( 3 – A )', '(4 _ A)', '(5-A)'])).series).toBe('A');
        expect(detectBookletSeries(footers(['(2-C)', '(3-C)', '(4-C)', '(5-A)'])).series).toBe('C');
    });
    it('refuses to guess when footers are missing or disagree', () => {
        expect(detectBookletSeries(footers(['(2-A)'])).series).toBeNull();
        expect(detectBookletSeries(footers(['(2-A)', '(3-A)', '(4-A)', '(5-B)', '(6-B)'])).series).toBeNull();
    });
});

describe('extractQuestions', () => {
    const opts = ['1 only', '2 only', 'Both 1 and 2', 'Neither 1 nor 2'];

    it('parses numbered questions with lists and four options across columns and pages', () => {
        const pages = [
            hindi,
            page([
                [{ number: '1.', rows: question('Consider the following statements :', opts) }],
                [{ number: '2.', rows: ['With reference to rivers, consider the following :', '1. Ganga rises at Gangotri', '2. Kaveri drains into the Bay', 'Which of the statements given above is/are correct ?', ...opts.map((o, i) => `(${'abcd'[i]}) ${o}`)] }],
            ]),
        ];
        const result = extractQuestions(pages, 2);
        expect(result.englishPages).toEqual([1]);
        expect(result.missingNumbers).toEqual([]);
        expect(result.questions[1]).toMatchObject({
            number: 2,
            stem: 'With reference to rivers, consider the following:\n1. Ganga rises at Gangotri\n2. Kaveri drains into the Bay\nWhich of the statements given above is/are correct?',
            options: opts,
            issues: [],
        });
    });

    it('does not split a question at "1." list items indented in the body', () => {
        const result = extractQuestions([page([[{ number: '1.', rows: ['Consider the following :', '1. Alpha item here', '2. Beta item here', 'How many of the above are correct ?', ...opts.map((o, i) => `(${'abcd'[i]}) ${o}`)] }], []])], 1);
        expect(result.questions).toHaveLength(1);
        expect(result.questions[0]!.stem).toContain('1. Alpha item here');
    });

    it('repairs OCR-misread margin numbers from the sequence and flags them', () => {
        // "I." is how the OCR reads "1."; "7." for 2 is a one-digit slip like "97." for 37.
        const pages = [page([
            [{ number: 'I.', rows: question('First question stem is long enough', opts) }],
            [{ number: '7. Which one of the following is right ?', rows: opts.map((o, i) => `(${'abcd'[i]}) ${o}`) }],
        ])];
        const result = extractQuestions(pages, 2);
        expect(result.questions.map((q) => q.number)).toEqual([1, 2]);
        expect(result.questions[1]!.issues).toContain('NUMBER_OCR_CORRECTED');
    });

    it('recovers a question whose margin number was not read at all, and flags it', () => {
        const pages = [page([
            [{ number: '1.', rows: question('First question stem is long enough', opts) }],
            [{ rows: question('Which one of the following shows a unique relationship ?', ['Fig', 'Mahua', 'Sandalwood', 'Silk cotton']) }],
        ])];
        const result = extractQuestions(pages, 2);
        expect(result.questions[1]).toMatchObject({ number: 2, options: ['Fig', 'Mahua', 'Sandalwood', 'Silk cotton'], issues: ['NUMBER_NOT_READ'] });
    });

    it('drops running footers and booklet codes, and skips cover pages', () => {
        const footer = [line('KSPC-P-GSPO (3-A)', 70, 1900)];
        const cover: OcrPage = page([[{ rows: ['DO NOT OPEN THIS TEST BOOKLET UNTIL YOU ARE TOLD TO DO SO', 'INSTRUCTIONS for the candidate follow here'] }], []]);
        const pages = [
            page([[{ number: '1.', rows: [...question('First question stem is long enough', opts.slice(0, 3)), '(d) Neither 1 nor 2 KSPC-P-GSPO'] }], []], footer),
            page([[{ number: '2.', rows: question('Second question stem is long enough', opts) }], []], footer),
            page([[{ number: '3.', rows: question('Third question stem is long enough', opts) }], []], footer),
            cover,
        ];
        const result = extractQuestions(pages, 3);
        expect(result.englishPages).toEqual([0, 1, 2]);
        expect(result.questions[0]!.options[3]).toBe('Neither 1 nor 2');
        expect(result.questions.flatMap((q) => [q.stem, ...q.options]).join(' ')).not.toMatch(/KSPC|DO NOT OPEN/);
    });

    it('attaches a passage to the questions it introduces', () => {
        const pages = [page([[
            { rows: ['Directions for the following 2 (two) items :'] },
            { rows: ['Passage', 'Rivers shape settlements and trade across the plains of northern India.'] },
            { number: '1.', rows: question('What is the main idea of the passage ?', ['Trade', 'Rivers', 'Plains', 'Towns']) },
            { number: '2.', rows: question('Which assumption is made in the passage ?', ['One', 'Two', 'Three', 'Four']) },
        ], []])];
        const result = extractQuestions(pages, 2);
        expect(result.questions.map((q) => q.preamble)).toEqual([
            'Passage Rivers shape settlements and trade across the plains of northern India.',
            'Passage Rivers shape settlements and trade across the plains of northern India.',
        ]);
        expect(result.questions[0]!.issues).not.toContain('PASSAGE_ATTACHMENT_UNVERIFIED');
    });

    it('flags missing options, tables and numbered statements the OCR dropped', () => {
        const pages = [page([[
            { number: '1.', rows: ['Consider the following statements :', '1. Alpha is true', '2. Beta is true', 'Select the correct answer :', '(a) 1 only', '(b) 1 and 4', '(c) 2 only'] },
            { number: '2.', rows: question('In how many of the above rows is the information correctly matched ?', ['Only one', 'Only two', 'Only three', 'All four']) },
        ], []])];
        const result = extractQuestions(pages, 2);
        expect(result.questions[0]!.issues).toEqual(expect.arrayContaining(['OPTIONS_INCOMPLETE', 'LIST_ITEM_MISSING']));
        expect(result.questions[1]!.issues).toContain('MAY_HAVE_TABLE');
    });

    it('normalises common OCR confusions in statement labels and punctuation', () => {
        expect(normalizeOcrText('Statement41 : Carbon dioxide ( CO2 ) is a gas ,')).toBe('Statement-II: Carbon dioxide (CO2) is a gas,');
    });
});

function keyPage(): OcrPage {
    const lines: OcrLine[] = [line('Series', 1575, 63)];
    for (let c = 0; c < 4; c += 1) {
        lines.push(line('Key', 420 + c * 190, 375));
        for (let r = 0; r < 15; r += 1) {
            const q = c * 15 + r + 1;
            if (q < 10 && c === 0) continue; // single digits are routinely skipped by OCR
            lines.push(line(String(q), 330 + c * 190 + (r % 2), 428 + r * 56 - c * 2));
        }
    }
    return { image: 'k.jpg', width: 2337, height: 1653, lines };
}

describe('answer key', () => {
    it('places one cell per question, fitting rows for numbers the OCR skipped', () => {
        const cells = keyGridCells(keyPage(), 50);
        expect(cells).toHaveLength(60);
        expect(cells[0]).toMatchObject({ id: '1', allowed: 'A,B,C,D,X' });
        expect(Math.abs(cells[0]!.y - cells[15]!.y)).toBeLessThanOrEqual(4); // Q1's number was skipped
        expect(cells[54]).toMatchObject({ id: '55', hint: '0' });
        expect(cells[0]!.x).toBe(420 - 24); // centred on the "Key" header
        expect(seriesCell(keyPage())).toMatchObject({ id: 'series', allowed: 'A,B,C,D' });
    });

    it('reads a headerless grid with 30 rows and a short last column', () => {
        const lines: OcrLine[] = [line('Series: C', 900, 60)];
        for (let q = 1; q <= 100; q += 1) {
            if (q % 7 === 0) continue; // scattered unread numbers
            const c = Math.floor((q - 1) / 30);
            lines.push(line(String(q), 200 + c * 400, 200 + ((q - 1) % 30) * 40));
        }
        const cells = keyGridCells({ image: 'k.jpg', width: 1700, height: 1500, lines }, 100);
        expect(cells).toHaveLength(100);
        const q35 = cells.find((c) => c.id === '35')!;
        expect(q35.y + q35.h / 2).toBeCloseTo(200 + 4 * 40 + 11, 0);
        expect(q35.x).toBeGreaterThan(600 + 24); // right of the number, not over it
        expect(seriesFromText({ image: 'k.jpg', width: 1, height: 1, lines })).toBe('C');
        expect(seriesFromText({ image: 'k.jpg', width: 1, height: 1, lines: [line('SET-B', 0, 0)] })).toBe('B');
    });

    it('rejects a page without a numbered grid', () => {
        expect(() => keyGridCells({ image: 'x', width: 10, height: 10, lines: [] }, 10)).toThrow(AnswerKeyLayoutError);
    });

    it('accepts only confident readings, records drops, and sends the rest to review', () => {
        const key = interpretKey([
            { id: '1', label: 'D', score: 0.9, margin: 0.4, ink: 200 },
            { id: '2', label: 'B', score: 0.45, margin: 0.07, ink: 200 },
            { id: '3', label: 'X', score: 0.8, margin: 0.5, ink: 150 },
            { id: '4', label: 'A', score: 0.8, margin: 0.1, ink: 150 },
            { id: '9', label: '0', score: 0.9, margin: 0.5, ink: 150 },
        ], 5);
        expect(key.answers).toEqual({ '1': 3 });
        expect(key.dropped).toEqual(['3']);
        expect(key.review.map((r) => r.questionRef)).toEqual(['2', '4', '5']);
    });
});

function draftInput(): BuildDraftInput {
    return {
        source: { id: 'upsc-x', program: 'UPSC_CSE', stage: 'PRELIMS', year: 2024, paperKey: 'UPSC-CSE-PRELIMS-GS1-2024', sourceName: 'UPSC', sourcePageUrl: 'https://upsc.gov.in/p' },
        receipt: { sha256: 'a'.repeat(64), answerKeySha256: 'b'.repeat(64), downloadUrl: 'https://upsc.gov.in/qp.pdf', answerKeyUrl: 'https://upsc.gov.in/key.pdf' },
        definition: { key: 'UPSC-CSE-PRELIMS-GS1', questionCount: 3, durationMin: 120 },
        series: 'A',
        extraction: {
            englishPages: [0],
            missingNumbers: [3],
            questions: [
                { number: 1, stem: 'Which river is the longest in India?', options: ['Ganga', 'Godavari', 'Krishna', 'Narmada'], issues: [], regions: [] },
                { number: 2, stem: 'Which one of these was dropped by UPSC?', options: ['A one', 'B two', 'C three', 'D four'], issues: [], regions: [] },
            ],
        },
        key: { answers: { '1': 0 }, dropped: ['2'], review: [{ questionRef: '3', guess: 'B', score: 0.4, margin: 0.05 }] },
        keyCells: [{ id: '1', x: 1, y: 2, w: 3, h: 4 }],
        pageImages: ['pages/page-01.jpg'],
        keyImage: 'key/key-1.jpg',
        now: new Date('2026-09-26T00:00:00Z'),
    };
}

describe('draft', () => {
    it('merges questions with the key and marks what needs review', () => {
        const draft = buildDraft(draftInput());
        expect(draft.subjectId).toBe('UPSC-CSE-GS1');
        expect(draft.questions.map((q) => [q.answerStatus, q.answer, q.reviewStatus])).toEqual([['AUTO', 0, 'PENDING'], ['DROPPED', null, 'PENDING'], ['NEEDS_REVIEW', null, 'PENDING']]);
        expect(draft.questions[2]).toMatchObject({ answerGuess: 'B', issues: ['NOT_FOUND_IN_SCAN'], options: ['', '', '', ''] });
    });

    const checksums = { questionPaper: 'a'.repeat(64), answerKey: 'b'.repeat(64) };
    const approve = (draft: PyqDraft): PyqDraft => ({ ...draft, questions: draft.questions.map((q) => ({ ...q, reviewStatus: 'APPROVED' as const })) });

    it('refuses anything a person has not approved and completed', () => {
        const result = finalizeDraft(buildDraft(draftInput()), checksums);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.problems).toEqual(['Q1 has not been approved by a reviewer.', 'Q2 has not been approved by a reviewer.', 'Q3 has not been approved by a reviewer.']);
        const incomplete = finalizeDraft(approve(buildDraft(draftInput())), checksums);
        expect(incomplete.ok).toBe(false);
        if (!incomplete.ok) expect(incomplete.problems).toEqual(expect.arrayContaining(['Q3 question text is empty or too short.', 'Q3 needs exactly four non-empty options.', 'Q3 needs a final answer (A–D) confirmed against the official key.']));
    });

    it('refuses a draft whose source PDFs changed', () => {
        const result = finalizeDraft(approve(buildDraft(draftInput())), { ...checksums, answerKey: 'c'.repeat(64) });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.problems[0]).toMatch(/answer-key PDF changed/);
    });

    it('produces the importer file with drops excluded and passages prepended', () => {
        const draft = approve(buildDraft(draftInput()));
        draft.questions[2] = { ...draft.questions[2]!, preamble: 'Passage text.', questionText: 'What does the passage imply?', options: ['W', 'X', 'Y', 'Z'], answer: 1, answerStatus: 'AUTO' };
        const result = finalizeDraft(draft, checksums, new Date('2026-09-26T10:00:00Z'));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.file).toMatchObject({ answerKey: { '1': 0, '3': 1 }, droppedQuestions: ['2'], reviewedAt: '2026-09-26T10:00:00.000Z', sourceUrl: 'https://upsc.gov.in/qp.pdf' });
        expect(result.file.questions.map((q) => q.questionRef)).toEqual(['1', '3']);
        expect(result.file.questions[1]!.questionText).toBe('Passage text.\n\nWhat does the passage imply?');
    });

    it('embeds the draft safely in the review page', () => {
        const draft = buildDraft(draftInput());
        draft.questions[0]!.questionText = 'Evil </script><script>alert(1)</script>';
        const html = renderReviewPage(draft);
        expect(html).not.toContain('</script><script>alert(1)');
        expect(html).toContain('\\u003c/script>');
    });
});
