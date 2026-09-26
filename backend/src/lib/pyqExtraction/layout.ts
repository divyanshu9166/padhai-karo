/**
 * Page-layout helpers for OCR output of official question papers.
 *
 * UPSC booklets print each page twice (Hindi, then English), in two columns, with question
 * numbers hanging in the left margin of each column. The OCR engine returns lines in no
 * reliable order and often splits one printed line into fragments ("(a)" and "Only one"), so
 * these helpers: pick the English pages, find the column gutter, and rebuild reading-order
 * rows by merging fragments that share a baseline.
 */

export interface OcrWord { text: string; x: number; y: number; w: number; h: number }
export interface OcrLine { text: string; words: OcrWord[] }
export interface OcrPage { image: string; width: number; height: number; lines: OcrLine[] }

export interface Box { x: number; y: number; w: number; h: number }

/** A reading-order row: fragments on the same baseline within one column, joined left to right. */
export interface Row extends Box {
    text: string;
    page: number;
    column: 0 | 1;
    /** x of the first fragment; question numbers hang left of the column's body text. */
    startX: number;
}

const QUESTION_NUMBER = /^(\d{1,3})\s*[.,]?$/;

export function lineBox(line: OcrLine): Box {
    const xs = line.words.map((w) => w.x);
    const ys = line.words.map((w) => w.y);
    const x1 = Math.max(...line.words.map((w) => w.x + w.w));
    const y1 = Math.max(...line.words.map((w) => w.y + w.h));
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: x1 - x, h: y1 - y };
}

export function unionBox(boxes: readonly Box[]): Box {
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w));
    const y1 = Math.max(...boxes.map((b) => b.y + b.h));
    return { x, y, w: x1 - x, h: y1 - y };
}

/**
 * True for a page whose text is mostly Latin script. The English OCR engine turns Devanagari
 * into a handful of junk fragments, so Hindi pages have few lines and few real words.
 */
export function isLatinTextPage(page: OcrPage): boolean {
    const words = page.lines.flatMap((line) => line.words.map((w) => w.text));
    const realWords = words.filter((w) => /^[A-Za-z][a-z]{2,}[.,:;?)]*$/.test(w)).length;
    // Hindi pages score under 0.1; symbol-heavy reasoning/maths pages in English can dip to ~0.35.
    return page.lines.length >= 30 && realWords >= 40 && realWords / Math.max(1, words.length) >= 0.25;
}

function lowPercentile(values: number[], fraction: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) * fraction)]!;
}

/**
 * The x coordinate separating the two columns, taken from where right-column question numbers
 * hang (they sit just right of the printed divider). Falls back to the page centre.
 */
export function columnBoundary(pages: readonly OcrPage[]): number {
    const width = pages[0]?.width ?? 0;
    const rightNumbers = pages.flatMap((page) => page.lines
        // The number is usually its own OCR line, but may be joined to the question's first words.
        .filter((line) => QUESTION_NUMBER.test(line.words[0]?.text.trim() ?? ''))
        .map((line) => lineBox(line).x)
        .filter((x) => x > page.width * 0.35 && x < page.width * 0.65));
    // Numbered list items inside right-column questions also match; they are indented past
    // the hanging question numbers, so the low end of the distribution marks the gutter.
    const x = lowPercentile(rightNumbers, 0.1);
    return x === null ? width / 2 : x - 25;
}

/** Rebuild reading-order rows for one page: left column top to bottom, then the right column. */
export function pageRows(page: OcrPage, pageIndex: number, boundary: number): Row[] {
    const header = page.height * 0.045;
    const footer = page.height * 0.94;
    const fragments = page.lines
        .map((line) => ({ line, box: lineBox(line) }))
        .filter(({ box, line }) => line.text.trim() !== '' && box.y > header && box.y < footer);
    const rows: Row[] = [];
    for (const column of [0, 1] as const) {
        const inColumn = fragments
            .filter(({ box }) => (column === 0 ? box.x < boundary : box.x >= boundary))
            .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
        let group: typeof inColumn = [];
        const flush = (): void => {
            if (group.length === 0) return;
            const ordered = [...group].sort((a, b) => a.box.x - b.box.x);
            const box = unionBox(ordered.map((f) => f.box));
            rows.push({ ...box, page: pageIndex, column, startX: ordered[0]!.box.x, text: ordered.map((f) => f.line.text.trim()).join(' ') });
            group = [];
        };
        for (const fragment of inColumn) {
            const anchor = group[0]?.box;
            const sameBaseline = anchor && Math.abs(fragment.box.y - anchor.y) <= Math.max(10, anchor.h * 0.6);
            if (!sameBaseline) flush();
            group.push(fragment);
        }
        flush();
    }
    return rows;
}

/**
 * The booklet series printed in the page footers ("( 2 – A )"), by majority over all pages, or
 * null when no footer mark was read. Answer keys are per series, so this guards the mapping.
 */
export function detectBookletSeries(pages: readonly OcrPage[]): { series: string | null; votes: Record<string, number> } {
    const votes: Record<string, number> = {};
    for (const page of pages) {
        for (const line of page.lines) {
            for (const match of line.text.matchAll(/\(\s*\d{1,2}\s*[-–—_]\s*([ABCD])\s*\)/g)) votes[match[1]!] = (votes[match[1]!] ?? 0) + 1;
        }
    }
    const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    const [top, second] = ranked;
    // Require a clear majority so one misread footer cannot decide the series.
    const series = top && top[1] >= 3 && (!second || top[1] >= second[1] * 3) ? top[0] : null;
    return { series, votes };
}

export { QUESTION_NUMBER };
