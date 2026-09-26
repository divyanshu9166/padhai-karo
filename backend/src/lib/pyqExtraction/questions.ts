/**
 * Turn reading-order rows from an objective paper into numbered questions with four options.
 *
 * The parser is deliberately conservative: it only starts a question at a number hanging in
 * the column margin that continues the expected sequence (so "1." inside a list of statements
 * never splits a question), it only accepts options in (a) → (d) order, and everything it is
 * unsure about becomes an issue on the question for the human reviewer rather than a guess.
 */
import { columnBoundary, isLatinTextPage, pageRows, unionBox, type Box, type OcrPage, type Row } from './layout';

export type QuestionIssue =
    | 'OPTIONS_INCOMPLETE'
    | 'STEM_SHORT'
    | 'MAY_HAVE_FIGURE'
    | 'OCR_NOISE'
    | 'PASSAGE_ATTACHMENT_UNVERIFIED'
    | 'NUMBER_SKIPPED_BEFORE'
    | 'NUMBER_OCR_CORRECTED'
    | 'NUMBER_NOT_READ'
    | 'MAY_HAVE_TABLE'
    | 'LIST_ITEM_MISSING'
    | 'MAY_HAVE_MATH'
    | 'OPTIONS_FROM_REOCR';

export interface SourceRegion extends Box { page: number }

export interface ExtractedQuestion {
    number: number;
    preamble?: string;
    stem: string;
    options: string[];
    issues: QuestionIssue[];
    /** Where the question sits on the rendered page images, for side-by-side review. */
    regions: SourceRegion[];
}

export interface ExtractionResult {
    questions: ExtractedQuestion[];
    /** Numbers in 1..expectedCount that were never found. */
    missingNumbers: number[];
    englishPages: number[];
}

// OCR reads the margin numbers' 1 and 0 as I, l, | and O; they are normalised before use.
const NUMBERED = /^([\dIl|O]{1,3})\s*[.,]?(?:\s+(.*))?$/;
const OPTION = /^\(\s*([abcd])\s*\)\s*(.*)$/i;
const PREAMBLE = /^(Directions?\b|Passage\b|Read the following)/i;
const COUNT_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
// Lines that start a new visual block inside a question stem.
const STEM_BREAK = /^(\d{1,2}\s*\.|[IVX]{1,4}\s*\.|Statement[-\s]?[IVX]+\b|List[-\s]?[IV]+\b|Which\b|How many\b|Select\b|Consider\b|In the light\b|With reference\b|Code\s*:)/;

/** Fix OCR confusions that are systematic in these booklets. */
export function normalizeOcrText(text: string): string {
    return text
        // "43 [ P.T.O." page-turn marks at the foot of a column.
        .replace(/\s*\d{0,3}\s*\[?\s*P\s*\.\s*T\s*\.\s*O\s*\.?\s*\]?/g, '')
        // The italic "%" in these booklets OCRs as "0/0": "200/0" is 20%, "93•750/0" is 93•75%.
        .replace(/(\d)0\/0(?!\d)/g, '$1%')
        .replace(/Statement\s*[-–]?\s*(?:41|4I|11|Il|lI|ll|I1|1I)\b/g, 'Statement-II')
        .replace(/Statement\s*[-–]?\s*(?:l|1|\|)\s*(?=[:\s,.]|$)/g, 'Statement-I ')
        .replace(/[‘’`]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/\s+([,.;:?)])/g, '$1')
        .replace(/\(\s+/g, '(')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function joinStem(lines: readonly string[]): string {
    let out = '';
    for (const raw of lines) {
        const line = normalizeOcrText(raw);
        if (!line) continue;
        out += out === '' ? line : (STEM_BREAK.test(line) ? '\n' : ' ') + line;
    }
    return out.replace(/ +\n/g, '\n').trim();
}

function preambleItemCount(text: string): number | null {
    const match = /following\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b[^.]*?\b(items?|questions?)/i.exec(text);
    if (!match) return null;
    const value = match[1]!.toLowerCase();
    return COUNT_WORDS[value] ?? Number(value);
}

function noisy(text: string): boolean {
    const tokens = text.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;
    const odd = tokens.filter((t) => /[^\x20-\x7E–—₹°%]/.test(t) || /[a-z][A-Z]{2,}|\d[a-z]{2,}\d/.test(t)).length;
    return odd / tokens.length > 0.08;
}

/**
 * Extract questions from the OCR of a whole booklet. `expectedCount` comes from the paper
 * definition (e.g. 100 for GS Paper I) and bounds the numbering sequence.
 */
export function extractQuestions(pages: readonly OcrPage[], expectedCount: number): ExtractionResult {
    // Front and back covers carry instructions in English; they never contain questions.
    const isCover = (page: OcrPage): boolean => page.lines.some((line) => /DO NOT OPEN THIS TEST BOOKLET/i.test(line.text));
    const englishPages = pages.map((page, index) => (isLatinTextPage(page) && !isCover(page) ? index : -1)).filter((index) => index >= 0);
    const selected = englishPages.map((index) => pages[index]!);
    const boundary = columnBoundary(selected);
    const allRows: Row[] = englishPages.flatMap((index) => pageRows(pages[index]!, index, boundary));
    // Running headers/footers ("KSPC-P-GSPO (13-A)") repeat on most pages once digits are ignored.
    const signature = (row: Row): string => row.text.replace(/[\d\s]/g, '').toLowerCase();
    const pagesWith = new Map<string, Set<number>>();
    for (const row of allRows) pagesWith.set(signature(row), new Set([...(pagesWith.get(signature(row)) ?? []), row.page]));
    // Only rows in the top or bottom margin qualify: option text such as "(a) 1 only" also repeats.
    const inMargin = (row: Row): boolean => { const height = pages[row.page]!.height; return row.y < height * 0.055 || row.y > height * 0.88; };
    const repeated = (row: Row): boolean => inMargin(row) && signature(row).replace(/[^a-z]/g, '').length >= 6 && (pagesWith.get(signature(row))?.size ?? 0) >= Math.max(3, englishPages.length * 0.5);
    // Booklet codes ("KSPC-P-GSPO") and page marks can also merge into a question's last row;
    // strip any hyphenated code token printed on most pages from the remaining text.
    const codePages = new Map<string, Set<number>>();
    for (const row of allRows) {
        for (const token of row.text.split(/\s+/)) {
            if (/^[A-Z0-9]{2,}(?:-[A-Z0-9]{1,})+$/.test(token)) codePages.set(token, new Set([...(codePages.get(token) ?? []), row.page]));
        }
    }
    const codes = new Set([...codePages].filter(([, seen]) => seen.size >= Math.max(3, englishPages.length * 0.5)).map(([token]) => token));
    const rows = allRows
        .filter((row) => !repeated(row))
        .map((row) => ({ ...row, text: row.text.split(/\s+/).filter((token) => !codes.has(token)).join(' ') }))
        .filter((row) => row.text.trim() !== '');

    // The body text of each column starts at a fairly constant x; question numbers hang left of it.
    const bodyX = new Map<string, number>();
    for (const key of new Set(rows.map((row) => row.page + ':' + row.column))) {
        const starts = rows.filter((row) => row.page + ':' + row.column === key).map((row) => row.startX).sort((a, b) => a - b);
        bodyX.set(key, starts[Math.floor(starts.length * 0.5)] ?? 0);
    }
    // Typical vertical pitch between consecutive rows of a column; questions are separated by more.
    const pitches: number[] = [];
    for (let i = 1; i < rows.length; i += 1) {
        const a = rows[i - 1]!, b = rows[i]!;
        if (a.page === b.page && a.column === b.column && b.y > a.y) pitches.push(b.y - a.y);
    }
    pitches.sort((a, b) => a - b);
    const pitch = pitches[Math.floor(pitches.length / 2)] ?? 40;

    type Draft = { number: number; stemLines: string[]; options: string[][]; rows: Row[]; preamble?: string; passageUnverified?: boolean; skipped?: boolean; corrected?: boolean; unread?: boolean };
    const questions: Draft[] = [];
    let current: Draft | null = null;
    let expected = 1;
    let preamble: { lines: string[]; remaining: number | null } | null = null;

    const start = (row: Row, number: number, firstLine: string | undefined, flags: Pick<Draft, 'skipped' | 'corrected' | 'unread'>): void => {
        const draft: Draft = { number, stemLines: firstLine ? [firstLine] : [], options: [], rows: [row], ...flags };
        if (preamble && preamble.lines.length > 0) {
            draft.preamble = joinStem(preamble.lines);
            draft.passageUnverified = preamble.remaining === null;
            if (preamble.remaining !== null) {
                preamble.remaining -= 1;
                if (preamble.remaining <= 0) preamble = null;
            }
        }
        questions.push(draft);
        current = draft;
        expected = number + 1;
    };

    for (const row of rows) {
        const text = row.text.trim();
        const numbered = NUMBERED.exec(text);
        const hangs = row.startX < (bodyX.get(row.page + ':' + row.column) ?? 0) - 30;
        const digits = numbered ? numbered[1]!.replace(/[Il|]/g, '1').replace(/O/g, '0') : '';
        const read = /^\d+$/.test(digits) ? Number(digits) : NaN;
        const inSequence = read >= expected && read <= Math.min(expectedCount, expected + 3);
        const cur = current as Draft | null;
        const complete = cur !== null && cur.options.length === 4;
        const last = cur?.rows[cur.rows.length - 1];
        const freshBlock = !last || last.page !== row.page || last.column !== row.column || row.y - last.y > pitch * 1.8;
        // A margin number that starts a question but differs from the expected one in a single
        // digit is an OCR slip ("97." for 37); take the sequence number and flag it for review.
        const oneDigitSlip = !inSequence && expected <= expectedCount && complete && Boolean(numbered?.[2])
            && digits.length === String(expected).length && [...digits].filter((d, i) => d !== String(expected)[i]).length === 1;
        // A question starts at a number hanging in the margin, or at any in-sequence number once the
        // previous question has all four options (passage pages indent numbers under full-width
        // passage text). Numbered statements inside a question always precede its options, so
        // they can never start a new question this way.
        if (numbered && (hangs || !cur || complete) && (inSequence || oneDigitSlip)) {
            const number = inSequence ? read : expected;
            start(row, number, numbered[2], { skipped: number > expected, corrected: oneDigitSlip });
            continue;
        }
        if (PREAMBLE.test(text) && (!cur || complete)) {
            // "Passage-2" inside a "Directions for the following 5 items" block keeps the count.
            const active = preamble as { remaining: number | null } | null;
            const remaining: number | null = preambleItemCount(text) ?? active?.remaining ?? null;
            preamble = { lines: /^Directions?\b/i.test(text) ? [] : [text], remaining };
            current = null;
            continue;
        }
        if (preamble && !cur) {
            preamble.lines.push(text);
            continue;
        }
        if (!cur) continue;
        const option = OPTION.exec(text);
        if (complete && freshBlock && !option) {
            // After option (d), a new block of capitalised text is the next question whose margin
            // number the OCR missed; anything else (rough-work pages, the back cover) is dropped.
            if (expected <= expectedCount && /^["'(A-Z]/.test(text)) start(row, expected, text, { unread: true });
            else if (expected > expectedCount) current = null;
            continue;
        }
        cur.rows.push(row);
        // Short numeric options are often printed side by side: "(a) 4 (b) 8 (c) 12 (d) 16".
        const segments = option ? text.split(/\s+(?=\(\s*[b-d]\s*\)\s)/i) : [text];
        for (const segment of segments) {
            const part = OPTION.exec(segment);
            const index = part ? 'abcd'.indexOf(part[1]!.toLowerCase()) : -1;
            if (part && index >= cur.options.length) {
                // Two-column option grids often lose their right-hand cells in OCR: keep "(c)" in
                // slot c and leave "(b)" empty for the second pass or the reviewer.
                while (cur.options.length < index) cur.options.push([]);
                cur.options.push(part[2] ? [part[2]] : []);
            } else if (part && cur.options[index]!.length === 0) {
                cur.options[index]!.push(part[2] ?? '');
            } else if (cur.options.length > 0) {
                cur.options[cur.options.length - 1]!.push(segment);
            } else {
                cur.stemLines.push(segment);
            }
        }
    }

    const found = new Set(questions.map((q) => q.number));
    const missingNumbers = Array.from({ length: expectedCount }, (_, i) => i + 1).filter((n) => !found.has(n));
    return {
        englishPages,
        missingNumbers,
        questions: questions.map((draft) => {
            const stem = joinStem(draft.stemLines);
            const options = draft.options.map((lines) => normalizeOcrText(lines.join(' ')));
            const issues: QuestionIssue[] = [];
            if (options.length !== 4 || options.some((option) => option.length === 0)) issues.push('OPTIONS_INCOMPLETE');
            if (stem.length < 15) issues.push('STEM_SHORT');
            if (/\b(figure|diagram|graph|map given|shown below|chart)\b/i.test(`${draft.preamble ?? ''} ${stem}`)) issues.push('MAY_HAVE_FIGURE');
            if (noisy(`${stem} ${options.join(' ')}`)) issues.push('OCR_NOISE');
            if (draft.passageUnverified) issues.push('PASSAGE_ATTACHMENT_UNVERIFIED');
            if (draft.skipped) issues.push('NUMBER_SKIPPED_BEFORE');
            if (draft.corrected) issues.push('NUMBER_OCR_CORRECTED');
            if (draft.unread) issues.push('NUMBER_NOT_READ');
            // Options such as "1, 2 and 4" refer to numbered statements; each must exist in the stem.
            const listed = new Set([...stem.matchAll(/(?:^|\n)(\d)\s*\./g)].map((m) => Number(m[1])));
            const referenced = new Set(options.flatMap((option) => [...option.matchAll(/\b([1-9])\b/g)].map((m) => Number(m[1]))));
            if (listed.size > 0 && [...referenced].some((n) => !listed.has(n))) issues.push('LIST_ITEM_MISSING');
            if (/\b(rows?|columns?|List[-\s]?I|correctly matched|Column[-\s]?[AB12])\b/i.test(stem)) issues.push('MAY_HAVE_TABLE');
            // Equations, angles, fractions and ratios are where OCR loses symbols (°, ½, √, ≤).
            if (/[=<>≤≥÷×√^•°½¼¾%]|\d\s*[+*/]\s*\d|\bx\s*[+\-=]|\b\d+:\d+\b|\bangle\b|\bratio\b|\bsum of\b/i.test(`${stem} ${options.join(' ')}`)) issues.push('MAY_HAVE_MATH');
            return { number: draft.number, ...(draft.preamble ? { preamble: draft.preamble } : {}), stem, options, issues, regions: reviewRegions(draft.rows, rows, questions.map((q) => q.rows[0]!), pages, boundary) };
        }),
    };
}

/**
 * Read "(a) … (d) …" options out of OCR lines from a re-scanned crop, wherever the markers fall
 * (one per line or several side by side). Letters that were not read stay undefined.
 */
export function readOptions(lines: readonly string[]): Array<string | undefined> {
    const found: Array<string | undefined> = [undefined, undefined, undefined, undefined];
    for (const line of lines) {
        for (const segment of line.split(/\s+(?=\(\s*[a-d]\s*\)\s)/i)) {
            const match = OPTION.exec(segment.trim());
            if (!match) continue;
            const index = 'abcd'.indexOf(match[1]!.toLowerCase());
            const text = normalizeOcrText(match[2] ?? '');
            if (text && found[index] === undefined) found[index] = text;
        }
    }
    return found;
}

/**
 * Fill empty option slots from a second OCR reading; returns the new options and whether any
 * slot was filled. Options already read in the first pass are never overwritten.
 */
export function fillOptions(options: readonly string[], reread: ReadonlyArray<string | undefined>): { options: string[]; filled: boolean } {
    let filled = false;
    const merged = [0, 1, 2, 3].map((i) => {
        const current = options[i]?.trim() ?? '';
        if (current) return current;
        const candidate = reread[i]?.trim();
        if (candidate) { filled = true; return candidate; }
        return '';
    });
    return { options: merged, filled };
}

/**
 * The scan area a reviewer compares a question with: for each page column it spans, the full
 * column width from the question's first row down to where the next question starts (or the
 * column's last row). Covering the whole gap keeps option lines the OCR skipped visible.
 */
function reviewRegions(own: readonly Row[], all: readonly Row[], starts: readonly Row[], pages: readonly OcrPage[], boundary: number): SourceRegion[] {
    const groups = new Map<string, Row[]>();
    for (const row of own) groups.set(`${row.page}:${row.column}`, [...(groups.get(`${row.page}:${row.column}`) ?? []), row]);
    return [...groups.values()].map((group) => {
        const { page, column } = group[0]!;
        const width = pages[page]!.width;
        const box = unionBox(group);
        const columnRows = all.filter((row) => row.page === page && row.column === column);
        const nextStart = starts.filter((row) => row.page === page && row.column === column && row.y > box.y + 5).map((row) => row.y).sort((a, b) => a - b)[0];
        const columnEnd = Math.max(...columnRows.map((row) => row.y + row.h));
        const bottom = nextStart !== undefined ? nextStart - 8 : columnEnd + 8;
        const left = column === 0 ? Math.max(0, Math.min(...columnRows.map((row) => row.x)) - 20) : boundary;
        const right = column === 0 ? boundary - 10 : width - 20;
        return { page, x: left, y: box.y - 8, w: right - left, h: Math.max(box.h + 16, bottom - box.y + 8) };
    });
}
