/**
 * Extract a DRAFT question set from an official question paper + answer key already downloaded
 * by `npm run pyq:prepare`. Nothing here writes to the database.
 *
 *   npm run pyq:extract -- <source-id>        e.g. upsc-cse-prelims-2024-gs1
 *
 * Steps (all local, no network, no paid APIs):
 *   1. Verify both PDFs still match the SHA-256 in their download receipt.
 *   2. Render every page with Poppler (PDF_RENDERER_BIN) into data/official-pyq-work/<id>/.
 *   3. OCR the pages with the built-in Windows OCR engine (scripts/pyq/ocr-windows.ps1).
 *   4. Parse numbered questions and their four options (src/lib/pyqExtraction/questions.ts),
 *      re-OCR-ing enlarged crops where options were missed (scripts/pyq/crop-regions.ps1).
 *   5. Find the answer-key page for the booklet series and read every key cell by template
 *      matching (scripts/pyq/classify-cells.ps1), flagging anything uncertain.
 *   6. Write data/official-pyq-drafts/<id>.draft.json and a review page
 *      data/official-pyq-work/<id>/review.html.
 *
 * A reviewer then opens review.html, compares each question with the scan, fixes OCR slips,
 * confirms every flagged answer against the official key and downloads the reviewed draft.
 * `npm run pyq:finalize` validates that file and produces the import-ready JSON.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

import { findPaperDefinition } from '../src/lib/exams';
import { interpretKey, keyGridCells, seriesCell, seriesFromText, type CellClassification, type KeyCell } from '../src/lib/pyqExtraction/answerKey';
import { detectBookletSeries, type OcrPage } from '../src/lib/pyqExtraction/layout';
import { extractQuestions, fillOptions, readOptions, type ExtractionResult } from '../src/lib/pyqExtraction/questions';
import { buildDraft, type OfficialSource, type Receipt } from '../src/lib/pyqExtraction/draft';
import { renderReviewPage } from '../src/lib/pyqExtraction/reviewPage';

const root = resolve(__dirname, '..');
// PDF_RENDERER_BIN usually lives in .env; load it when present (never required).
try { process.loadEnvFile(join(root, '.env')); } catch { /* no .env file */ }
const manifestPath = resolve(process.env.OFFICIAL_PYQ_MANIFEST?.trim() || join(root, 'data/official-pyq-sources.json'));
const downloads = resolve(process.env.OFFICIAL_PYQ_DOWNLOAD_DIR?.trim() || join(root, 'data/official-pyq-downloads'));
const drafts = join(root, 'data/official-pyq-drafts');
const scripts = join(root, 'scripts/pyq');

function fail(message: string): never { throw new Error(`pyq:extract — ${message}`); }

function sha256(path: string): string { return createHash('sha256').update(readFileSync(path)).digest('hex'); }

function pdftoppm(): string {
    const configured = process.env.PDF_RENDERER_BIN?.trim();
    if (configured) return configured;
    return process.platform === 'win32' ? 'pdftoppm.exe' : 'pdftoppm';
}

function powershell(script: string, args: string[]): string {
    if (process.platform !== 'win32') fail('OCR uses the built-in Windows OCR engine; run extraction on Windows.');
    return execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(scripts, script), ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** Render a PDF to JPEG pages (JPEG is ~50x faster than PNG here and OCRs identically). */
function render(pdf: string, directory: string, prefix: string): string[] {
    mkdirSync(directory, { recursive: true });
    execFileSync(pdftoppm(), ['-r', '200', '-jpeg', '-jpegopt', 'quality=92', pdf, join(directory, prefix)], { stdio: 'inherit' });
    return readdirSync(directory)
        .filter((file) => file.startsWith(`${prefix}-`) && file.endsWith('.jpg'))
        .sort((a, b) => Number(/-(\d+)\.jpg$/.exec(a)![1]) - Number(/-(\d+)\.jpg$/.exec(b)![1]))
        .map((file) => join(directory, file));
}

function ocr(images: string[], outFile: string): OcrPage[] {
    powershell('ocr-windows.ps1', ['-OutFile', outFile, ...images]);
    const byImage = new Map(readFileSync(outFile, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line) as OcrPage).map((page) => [resolve(page.image), page]));
    return images.map((image) => byImage.get(resolve(image)) ?? fail(`OCR produced no result for ${image}`));
}

function classify(image: string, cells: KeyCell[], work: string, name: string): CellClassification[] {
    const cellsFile = join(work, `${name}.cells.json`);
    const outFile = join(work, `${name}.classes.json`);
    writeFileSync(cellsFile, JSON.stringify(cells));
    powershell('classify-cells.ps1', ['-Image', image, '-Cells', cellsFile, '-OutFile', outFile]);
    const parsed = JSON.parse(readFileSync(outFile, 'utf8').replace(/^﻿/, '')) as CellClassification | CellClassification[];
    return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * Second OCR pass for questions whose options were not all read: full-page OCR tends to skip
 * short options printed side by side ("(a) 20%   (b) 10%"). Each such question's last region is
 * cropped, enlarged at two scales and OCR-ed again; only empty option slots are filled, and the
 * question keeps its review flags. Returns how many questions gained options.
 */
function reocrIncompleteOptions(extraction: ExtractionResult, pageImages: string[], work: string): number {
    const targets = extraction.questions.filter((q) => q.issues.includes('OPTIONS_INCOMPLETE') && q.regions.length > 0);
    if (targets.length === 0) return 0;
    const directory = join(work, 'reocr');
    mkdirSync(directory, { recursive: true });
    const scales = [2, 3];
    const crops = scales.flatMap((scale) => targets.map((q) => {
        const region = q.regions[q.regions.length - 1]!;
        return { scale, number: q.number, image: pageImages[region.page]!, x: region.x, y: region.y, w: region.w, h: region.h, out: join(directory, `q${q.number}-x${scale}.png`) };
    }));
    for (const scale of scales) {
        const regionsFile = join(directory, `regions-x${scale}.json`);
        writeFileSync(regionsFile, JSON.stringify(crops.filter((c) => c.scale === scale)));
        powershell('crop-regions.ps1', ['-Regions', regionsFile, '-Scale', String(scale)]);
    }
    const pages = ocr(crops.map((c) => c.out).filter((path) => existsSync(path)), join(directory, 'reocr.jsonl'));
    const linesByQuestion = new Map<number, string[]>();
    pages.forEach((page) => {
        const number = Number(/q(\d+)-x\d+\.png$/.exec(page.image)?.[1]);
        linesByQuestion.set(number, [...(linesByQuestion.get(number) ?? []), ...page.lines.map((line) => line.text)]);
    });
    let improved = 0;
    for (const q of targets) {
        const { options, filled } = fillOptions(q.options, readOptions(linesByQuestion.get(q.number) ?? []));
        if (!filled) continue;
        improved += 1;
        q.options = options;
        q.issues = q.issues.filter((issue) => issue !== 'OPTIONS_INCOMPLETE');
        if (options.some((option) => option === '')) q.issues.push('OPTIONS_INCOMPLETE');
        q.issues.push('OPTIONS_FROM_REOCR');
    }
    return improved;
}

async function main(): Promise<void> {
    const id = process.argv[2]?.trim() || fail('pass the source id from data/official-pyq-sources.json');
    const sources = JSON.parse(readFileSync(manifestPath, 'utf8')) as OfficialSource[];
    const source = sources.find((item) => item.id === id) ?? fail(`unknown source id "${id}"`);
    const receiptPath = join(downloads, `${id}.receipt.json`);
    if (!existsSync(receiptPath)) fail(`no download receipt for ${id}; run npm run pyq:prepare first`);
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as Receipt;
    const paperPdf = join(downloads, `${id}.pdf`);
    const keyPdf = receipt.answerKeyPath ? resolve(receipt.answerKeyPath) : join(downloads, `${id}-answer-key.pdf`);
    if (sha256(paperPdf) !== receipt.sha256) fail(`${basename(paperPdf)} no longer matches its receipt checksum`);
    if (!existsSync(keyPdf) || !receipt.answerKeySha256 || sha256(keyPdf) !== receipt.answerKeySha256) fail('the answer-key PDF is missing or does not match its receipt checksum');

    const definition = findPaperDefinition(source.program, source.stage as never, source.paperKey) ?? fail(`paperKey ${source.paperKey} is not a known objective paper`);
    const expected = definition.questionCount ?? fail(`${definition.key} has no fixed question count`);
    const series = (source.series ?? 'A').toUpperCase();

    const work = join(root, 'data/official-pyq-work', id);
    rmSync(work, { recursive: true, force: true });
    console.log(`Rendering ${basename(paperPdf)} and ${basename(keyPdf)}…`);
    const paperImages = render(paperPdf, join(work, 'pages'), 'page');
    const keyImages = render(keyPdf, join(work, 'key'), 'key');

    console.log(`OCR on ${paperImages.length} paper pages and ${keyImages.length} key pages…`);
    const paperPages = ocr(paperImages, join(work, 'paper.ocr.jsonl'));
    const keyPages = ocr(keyImages, join(work, 'key.ocr.jsonl'));

    // A wrong series would silently pair every question with another booklet's answers.
    const printed = detectBookletSeries(paperPages);
    if (printed.series && printed.series !== series) fail(`the paper's footers read series ${printed.series} (${JSON.stringify(printed.votes)}), but the manifest says ${series}; fix "series"`);
    if (!printed.series) console.warn(`Warning: could not read the booklet series from page footers (${JSON.stringify(printed.votes)}); relying on the manifest value ${series}.`);

    const extraction = extractQuestions(paperPages, expected);
    const refilled = reocrIncompleteOptions(extraction, paperImages, work);

    // The key PDF holds one page per booklet series; pick the page printed for ours.
    let keyIndex = -1;
    const seriesReads: string[] = [];
    const confident: Array<{ index: number; label: string }> = [];
    for (const [index, page] of keyPages.entries()) {
        // Printed text ("Series A", "SET-A") is read by OCR; boxed single letters need matching.
        const printedSeries = seriesFromText(page);
        if (printedSeries) {
            seriesReads.push(`${printedSeries}(text)`);
            confident.push({ index, label: printedSeries });
            if (printedSeries === series && keyIndex < 0) keyIndex = index;
            continue;
        }
        const cell = seriesCell(page);
        if (!cell) { seriesReads.push('?'); continue; }
        const [read] = classify(keyImages[index]!, [cell], work, `series-${index + 1}`);
        seriesReads.push(read ? `${read.label}(${read.score.toFixed(2)})` : '?');
        if (read && read.score >= 0.5) confident.push({ index, label: read.label });
        if (read && read.label === series && read.score >= 0.5 && keyIndex < 0) keyIndex = index;
    }
    // Faint scans can hide our page's letter. Keys print the series in A–D order, so when every
    // confident read agrees with that order, the page position identifies the series.
    const inOrder = keyPages.length === 4 && confident.length > 0 && confident.every((c) => 'ABCD'[c.index] === c.label);
    if (keyIndex < 0 && inOrder && 'ABCD'.includes(series)) {
        keyIndex = 'ABCD'.indexOf(series);
        console.warn(`Warning: series ${series} was not read on any key page (read: ${seriesReads.join(', ')}); using page ${keyIndex + 1} from the A–D page order.`);
    }
    if (source.keyPage) keyIndex = source.keyPage - 1;
    if (keyIndex < 0) fail(`no answer-key page was read as series ${series} (read: ${seriesReads.join(', ')}); set "keyPage" in the manifest`);
    const cells = keyGridCells(keyPages[keyIndex]!, expected);
    const key = interpretKey(classify(keyImages[keyIndex]!, cells, work, 'key'), expected);

    const draft = buildDraft({
        source,
        receipt,
        definition: { key: definition.key, questionCount: expected, durationMin: definition.durationMin ?? 120 },
        series,
        extraction,
        key,
        keyCells: cells,
        pageImages: paperImages.map((image) => relative(work, image).replaceAll('\\', '/')),
        keyImage: relative(work, keyImages[keyIndex]!).replaceAll('\\', '/'),
    });
    mkdirSync(drafts, { recursive: true });
    const draftPath = join(drafts, `${id}.draft.json`);
    writeFileSync(draftPath, JSON.stringify(draft, null, 2) + '\n');
    writeFileSync(join(work, 'review.html'), renderReviewPage(draft));

    const flagged = draft.questions.filter((q) => q.issues.length > 0 || q.answerStatus === 'NEEDS_REVIEW').length;
    console.log(JSON.stringify({
        id,
        series,
        keyPage: keyIndex + 1,
        questionsFound: extraction.questions.length,
        optionsRecoveredBySecondOcr: refilled,
        expected,
        missing: extraction.missingNumbers,
        answersReadConfidently: Object.keys(key.answers).length,
        answersNeedingReview: key.review.map((r) => r.questionRef),
        dropped: key.dropped,
        questionsFlagged: flagged,
        draft: relative(root, draftPath),
        review: relative(root, join(work, 'review.html')),
    }, null, 2));
    console.log('Next: open the review page, verify EVERY question against the scan, then download the reviewed draft and run npm run pyq:finalize.');
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
