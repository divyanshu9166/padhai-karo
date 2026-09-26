/**
 * Turn a reviewed PYQ draft (downloaded from the review page) into an import-ready file.
 *
 *   npm run pyq:finalize -- <path/to/source-id.reviewed.json>
 *
 * Refuses to write anything unless every question is approved, has four options and a final
 * answer (or is a confirmed UPSC drop), and the source PDFs still match the checksums the draft
 * was extracted from. Output: data/official-pyq-reviewed/<source-id>.json, then import it with
 *   OFFICIAL_PYQ_FILE=data/official-pyq-reviewed/<source-id>.json npm run pyq:import
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { finalizeDraft, type PyqDraft, type Receipt } from '../src/lib/pyqExtraction/draft';

const root = resolve(__dirname, '..');
const downloads = resolve(process.env.OFFICIAL_PYQ_DOWNLOAD_DIR?.trim() || join(root, 'data/official-pyq-downloads'));

function sha256(path: string): string { return createHash('sha256').update(readFileSync(path)).digest('hex'); }

function main(): void {
    const input = process.argv[2]?.trim();
    if (!input) throw new Error('pyq:finalize — pass the reviewed draft JSON downloaded from the review page.');
    const draft = JSON.parse(readFileSync(resolve(input), 'utf8')) as PyqDraft;
    const receipt = JSON.parse(readFileSync(join(downloads, `${draft.sourceId}.receipt.json`), 'utf8')) as Receipt;
    const keyPdf = receipt.answerKeyPath ? resolve(receipt.answerKeyPath) : join(downloads, `${draft.sourceId}-answer-key.pdf`);
    const result = finalizeDraft(draft, { questionPaper: sha256(join(downloads, `${draft.sourceId}.pdf`)), answerKey: sha256(keyPdf) });
    if (!result.ok) {
        console.error(`Not import-ready — ${result.problems.length} problem(s):`);
        for (const problem of result.problems.slice(0, 60)) console.error(`  • ${problem}`);
        if (result.problems.length > 60) console.error(`  … and ${result.problems.length - 60} more`);
        process.exitCode = 1;
        return;
    }
    const outDir = join(root, 'data/official-pyq-reviewed');
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, `${draft.sourceId}.json`);
    writeFileSync(outPath, JSON.stringify(result.file, null, 2) + '\n');
    console.log(JSON.stringify({ written: relative(root, outPath), questions: result.file.questions.length, dropped: result.file.droppedQuestions }, null, 2));
    console.log(`Import with: OFFICIAL_PYQ_FILE=${relative(root, outPath).replaceAll('\\', '/')} npm run pyq:import`);
}

try { main(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
