/**
 * Answer-key tables: locate the cells from OCR geometry, then turn glyph classifications into a
 * final key.
 *
 * UPSC keys are grids of "question number | key letter" column pairs numbered down the columns,
 * but every year differs: 15, 20 or 30 rows, with or without "Q. No. / Key" headers, portrait or
 * landscape, and a shorter last column. The key letters themselves are classified by template
 * matching (scripts/pyq/classify-cells.ps1) because OCR engines ignore isolated single letters;
 * the OCR pass here only has to read enough question numbers to recover the grid.
 */
import type { Box, OcrPage, OcrWord } from './layout';

export interface KeyCell extends Box {
    id: string;
    /** Labels the cell may take; question rows exclude "0" (the marker for unused rows). */
    allowed?: string;
    /** Label known in advance (unused rows past the paper's length), used to seed templates. */
    hint?: string;
}

export interface CellClassification { id: string; label: string; score: number; margin: number; ink: number }

export interface KeyThresholds { minScore: number; minMargin: number }

/** Calibrated on the 2024 GS Paper I key: no wrong label cleared these thresholds. */
export const DEFAULT_KEY_THRESHOLDS: KeyThresholds = { minScore: 0.7, minMargin: 0.15 };

export interface InterpretedKey {
    /** questionRef → option index 0..3 for confidently read answers. */
    answers: Record<string, number>;
    /** Questions the official key marks as dropped ("X"). */
    dropped: string[];
    /** Cells a reviewer must confirm, with the classifier's best guess. */
    review: Array<{ questionRef: string; guess: string; score: number; margin: number }>;
}

export class AnswerKeyLayoutError extends Error {}

function words(page: OcrPage): OcrWord[] {
    return page.lines.flatMap((line) => line.words);
}

interface NumberToken extends OcrWord { value: number }

/** Longest run of tokens whose values increase with y: drops stray header numbers ("Total 100"). */
function increasingRun(tokens: NumberToken[]): NumberToken[] {
    const sorted = [...tokens].sort((a, b) => a.y - b.y);
    const best: NumberToken[][] = [];
    for (let i = 0; i < sorted.length; i += 1) {
        let chain: NumberToken[] = [sorted[i]!];
        for (let j = 0; j < i; j += 1) {
            if (sorted[j]!.value < sorted[i]!.value && best[j]!.length + 1 > chain.length) chain = [...best[j]!, sorted[i]!];
        }
        best.push(chain);
    }
    return best.reduce((a, b) => (b.length > a.length ? b : a), [] as NumberToken[]);
}

/** Least-squares y = a + b·row for one column's recognised numbers. */
function fitRows(points: Array<{ row: number; y: number }>): { a: number; b: number } | null {
    if (points.length < 2) return null;
    const n = points.length;
    const mr = points.reduce((s, p) => s + p.row, 0) / n;
    const my = points.reduce((s, p) => s + p.y, 0) / n;
    const sxx = points.reduce((s, p) => s + (p.row - mr) ** 2, 0);
    if (sxx === 0) return null;
    const b = points.reduce((s, p) => s + (p.row - mr) * (p.y - my), 0) / sxx;
    return { a: my - b * mr, b };
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * Build one cell per question from the key grid on `page`: question numbers are clustered into
 * columns, the rows-per-column count is the one that places every read number in its own column,
 * each column's rows are fitted by least squares (scans are tilted, and single-digit numbers are
 * often not read), and the key cell is the space right of the numbers — centred on a "Key" header
 * when the table has them.
 */
export function keyGridCells(page: OcrPage, totalQuestions: number): KeyCell[] {
    const all = words(page);
    const tokens: NumberToken[] = all
        .filter((w) => /^\d{1,3}$/.test(w.text))
        .map((w) => ({ ...w, value: Number(w.text) }))
        .filter((w) => w.value >= 1 && w.value <= totalQuestions + 40);

    // Cluster by horizontal centre; key-letter columns contain no digits, so they separate clusters.
    const byCentre = [...tokens].sort((a, b) => a.x + a.w / 2 - (b.x + b.w / 2));
    const clusters: NumberToken[][] = [];
    for (const token of byCentre) {
        const last = clusters[clusters.length - 1];
        const centre = token.x + token.w / 2;
        const lastCentre = last ? median(last.map((t) => t.x + t.w / 2)) : -Infinity;
        if (last && centre - lastCentre < 40) last.push(token);
        else clusters.push([token]);
    }
    const candidates = clusters.map(increasingRun).filter((column) => column.length >= 3);
    if (candidates.length < 2) throw new AnswerKeyLayoutError(`Found ${candidates.length} numbered key columns; expected at least two.`);

    // Rows per column: the smallest count for which the read numbers fall in their own column.
    // A few strays (stamps, misreads) are tolerated and dropped; a wrong count misplaces dozens.
    const readCount = candidates.reduce((sum, column) => sum + column.length, 0);
    const tolerance = Math.max(1, Math.floor(readCount * 0.03));
    let rowsPerColumn = 0;
    for (let rows = 5; rows <= 60 && rowsPerColumn === 0; rows += 1) {
        if (rows * candidates.length < totalQuestions) continue;
        const misplaced = candidates.reduce((sum, column, index) => sum + column.filter((t) => Math.floor((t.value - 1) / rows) !== index).length, 0);
        if (misplaced <= tolerance) rowsPerColumn = rows;
    }
    if (rowsPerColumn === 0) throw new AnswerKeyLayoutError('The key numbers do not form a column-major grid.');
    const columns = candidates.map((column, index) => column.filter((t) => Math.floor((t.value - 1) / rowsPerColumn) === index));

    const fits = columns.map((column) => fitRows(column.map((t) => ({ row: (t.value - 1) % rowsPerColumn, y: t.y }))));
    const slope = median(fits.filter((fit): fit is { a: number; b: number } => fit !== null).map((fit) => fit.b));
    const numberHeight = median(tokens.map((t) => t.h));
    const rightEdges = columns.map((column) => Math.max(...column.map((t) => t.x + t.w)));
    const leftEdges = columns.map((column) => Math.min(...column.map((t) => t.x)));
    const keyHeaders = all.filter((w) => /^Key$/i.test(w.text)).sort((a, b) => a.x - b.x);
    const gaps = columns.slice(0, -1).map((_, i) => leftEdges[i + 1]! - rightEdges[i]!);
    const typicalGap = median(gaps);
    const centres = columns.map((column) => median(column.map((t) => t.x + t.w / 2)));
    const readY = columns.map((column) => new Map(column.map((t) => [(t.value - 1) % rowsPerColumn, t.y])));
    // Scans are tilted: y drifts across the page by this much per pixel of x.
    const tilts: number[] = [];
    for (let c = 0; c + 1 < columns.length; c += 1) {
        for (const [row, y] of readY[c]!) {
            const other = readY[c + 1]!.get(row);
            if (other !== undefined) tilts.push((other - y) / (centres[c + 1]! - centres[c]!));
        }
    }
    const tilt = median(tilts);
    /**
     * y of a row's number. Printed rows are not evenly spaced, so a row whose number was not
     * read is taken from the nearest column where that row was read, before falling back to
     * this column's line fit.
     */
    const rowY = (index: number, row: number, fit: { a: number; b: number }): number => {
        const own = readY[index]!.get(row);
        if (own !== undefined) return own;
        for (let distance = 1; distance < columns.length; distance += 1) {
            for (const other of [index - distance, index + distance]) {
                const y = readY[other]?.get(row);
                if (y !== undefined) return y + tilt * (centres[index]! - centres[other]!);
            }
        }
        return fit.a + fit.b * row;
    };

    const cells: KeyCell[] = [];
    columns.forEach((column, index) => {
        const fit = fits[index] ?? { a: column[0]!.y - slope * ((column[0]!.value - 1) % rowsPerColumn), b: slope };
        const right = rightEdges[index]!;
        const nextLeft = leftEdges[index + 1] ?? right + typicalGap;
        const header = keyHeaders.find((h) => h.x > right && h.x + h.w < nextLeft);
        // Without headers the letter sits mid-way between this column's numbers and the next's
        // (in its own table cell, or loose beside the number); the window straddles that point.
        const w = header ? header.w + 48 : Math.max(20, Math.min((nextLeft - right) * 0.6, numberHeight * 5));
        const x = header ? header.x - 24 : (right + nextLeft) / 2 - w / 2;
        // Taller than a row: the matcher keeps the one whole glyph and ignores neighbours' letters
        // clipped at the edges, so small row-position errors cannot cut the letter off.
        const h = Math.max(36, Math.min(Math.abs(slope) * 1.5 || 60, 96));
        const drift = tilt * (x + w / 2 - centres[index]!);
        // Rows past the last question exist only on keys that print them (as "0"); a shorter last
        // column must not produce cells over blank paper.
        const lastPrinted = Math.max(totalQuestions, ...column.map((t) => t.value));
        for (let row = 0; row < rowsPerColumn; row += 1) {
            const q = index * rowsPerColumn + row + 1;
            if (q > lastPrinted) break;
            const centreY = rowY(index, row, fit) + drift + numberHeight / 2;
            const cell: KeyCell = { id: String(q), x: Math.round(x), y: Math.round(centreY - h / 2), w: Math.round(w), h: Math.round(h) };
            if (q > totalQuestions) cell.hint = '0';
            else cell.allowed = 'A,B,C,D,X';
            cells.push(cell);
        }
    });
    const covered = new Set(cells.map((c) => Number(c.id)));
    const missing = Array.from({ length: totalQuestions }, (_, i) => i + 1).filter((q) => !covered.has(q));
    if (missing.length > 0) throw new AnswerKeyLayoutError(`The key grid does not cover questions ${missing.slice(0, 10).join(', ')}.`);
    return cells;
}

/** The series printed as text next to its label: "Series A", "Series: A", "SET-A". */
export function seriesFromText(page: OcrPage): string | null {
    for (const line of page.lines) {
        const match = /\b(?:Series|SET)\s*[:\-–]?\s*([ABCD])\b/i.exec(line.text);
        if (match) return match[1]!.toUpperCase();
    }
    return null;
}

/** The cell holding the booklet series letter, just right of the printed "Series" label. */
export function seriesCell(page: OcrPage): KeyCell | null {
    const label = words(page).find((w) => /^Series:?$/i.test(w.text));
    if (!label) return null;
    // Stay inside the value box: its border would otherwise be the largest ink component.
    // Three label-heights tall: box borders are erased and clipped neighbours ignored by the matcher.
    return { id: 'series', x: label.x + label.w + 72, y: label.y - label.h, w: 96, h: label.h * 3, allowed: 'A,B,C,D' };
}

export function interpretKey(results: readonly CellClassification[], totalQuestions: number, thresholds: KeyThresholds = DEFAULT_KEY_THRESHOLDS): InterpretedKey {
    const answers: Record<string, number> = {};
    const dropped: string[] = [];
    const review: InterpretedKey['review'] = [];
    for (const result of results) {
        const q = Number(result.id);
        if (!Number.isInteger(q) || q < 1 || q > totalQuestions) continue;
        const confident = result.score >= thresholds.minScore && result.margin >= thresholds.minMargin;
        if (!confident || !'ABCDX'.includes(result.label) || result.label === '') {
            review.push({ questionRef: result.id, guess: result.label, score: result.score, margin: result.margin });
        } else if (result.label === 'X') {
            dropped.push(result.id);
        } else {
            answers[result.id] = 'ABCD'.indexOf(result.label);
        }
    }
    const seen = new Set(results.map((r) => Number(r.id)));
    for (let q = 1; q <= totalQuestions; q += 1) {
        if (!seen.has(q)) review.push({ questionRef: String(q), guess: '?', score: 0, margin: 0 });
    }
    return { answers, dropped, review: review.sort((a, b) => Number(a.questionRef) - Number(b.questionRef)) };
}
