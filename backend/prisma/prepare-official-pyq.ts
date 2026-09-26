import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type Source = {
    id: string;
    program: 'UPSC_CSE' | 'SSC_CGL';
    stage: string;
    year: number;
    paperKey: string;
    sourceName: string;
    sourcePageUrl: string;
    downloadUrl?: string;
    answerKeyUrl?: string;
    requiresFinalKeyReview: boolean;
    notes?: string;
};

const allowedHosts = ['upsc.gov.in', 'ssc.gov.in'];
const manifestPath = resolve(process.env.OFFICIAL_PYQ_MANIFEST?.trim() || 'data/official-pyq-sources.json');
const outputDirectory = resolve(process.env.OFFICIAL_PYQ_DOWNLOAD_DIR?.trim() || 'data/official-pyq-downloads');
const maxBytes = 80 * 1024 * 1024;

function assertOfficialUrl(raw: string, label: string): URL {
    let url: URL;
    try { url = new URL(raw); } catch { throw new Error(`${label} must be a valid URL.`); }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
        throw new Error(`${label} must be HTTPS and hosted on upsc.gov.in or ssc.gov.in.`);
    }
    return url;
}

/**
 * Fetch a PDF body, retrying dropped connections: the UPSC server regularly terminates large
 * transfers mid-way. HTTP errors are not retried, and redirects stay forbidden.
 */
async function fetchPdf(url: URL, label: string, attempts = 4): Promise<Buffer> {
    for (let attempt = 1; ; attempt += 1) {
        try {
            const response = await fetch(url, { redirect: 'error', headers: { Accept: 'application/pdf,application/octet-stream' }, signal: AbortSignal.timeout(180_000) });
            if (!response.ok) throw Object.assign(new Error(`${label} returned HTTP ${response.status}.`), { final: true });
            return Buffer.from(await response.arrayBuffer());
        } catch (error) {
            if ((error as { final?: boolean }).final || attempt >= attempts) throw error;
            console.warn(`${label} interrupted (${error instanceof Error ? error.message : error}); retrying ${attempt}/${attempts - 1}…`);
            await new Promise((done) => setTimeout(done, attempt * 3000));
        }
    }
}

async function download(source: Source): Promise<void> {
    assertOfficialUrl(source.sourcePageUrl, `${source.id}.sourcePageUrl`);
    if (!source.downloadUrl) {
        console.log(JSON.stringify({ id: source.id, skipped: true, reason: 'No public download URL; complete the official candidate/login flow.' }));
        return;
    }
    const url = assertOfficialUrl(source.downloadUrl, `${source.id}.downloadUrl`);
    const bytes = await fetchPdf(url, `${source.id}: official download`);
    if (bytes.length === 0 || bytes.length > maxBytes) throw new Error(`${source.id}: download size is outside the safe limit.`);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const base = source.id.replace(/[^a-zA-Z0-9._-]/g, '_');
    const documentPath = resolve(outputDirectory, `${base}.pdf`);
    let answerKeyPath: string | undefined;
    let answerKeyChecksum: string | undefined;
    let answerKeyBytes: number | undefined;
    if (source.answerKeyUrl) {
        const answerKeyUrl = assertOfficialUrl(source.answerKeyUrl, `${source.id}.answerKeyUrl`);
        const answerKey = await fetchPdf(answerKeyUrl, `${source.id}: official answer-key download`);
        if (answerKey.length === 0 || answerKey.length > maxBytes) throw new Error(`${source.id}: answer-key size is outside the safe limit.`);
        answerKeyChecksum = createHash('sha256').update(answerKey).digest('hex');
        answerKeyBytes = answerKey.length;
        answerKeyPath = resolve(outputDirectory, `${base}-answer-key.pdf`);
        try { await writeFile(answerKeyPath, answerKey, { flag: 'wx' }); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            const existingAnswerKey = await readFile(answerKeyPath);
            const existingChecksum = createHash('sha256').update(existingAnswerKey).digest('hex');
            if (existingChecksum !== answerKeyChecksum) throw new Error(`${source.id}: existing answer-key checksum differs; move it aside and retry.`);
        }
    }
    const receiptPath = resolve(outputDirectory, `${base}.receipt.json`);
    try {
        await writeFile(documentPath, bytes, { flag: 'wx' });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const existing = await readFile(documentPath);
        const existingChecksum = createHash('sha256').update(existing).digest('hex');
        if (existingChecksum !== checksum) throw new Error(`${source.id}: existing file checksum differs; move it aside and retry.`);
    }
    await writeFile(receiptPath, JSON.stringify({ ...source, downloadUrl: url.toString(), bytes: bytes.length, sha256: checksum, ...(answerKeyPath ? { answerKeyPath, answerKeyBytes, answerKeySha256: answerKeyChecksum } : {}), downloadedAt: new Date().toISOString(), finalKeyReviewed: false }, null, 2) + '\n');
    console.log(JSON.stringify({ id: source.id, saved: documentPath, sha256: checksum, ...(answerKeyPath ? { answerKeyPath, answerKeySha256: answerKeyChecksum } : {}), finalKeyReviewed: false }));
}

async function main(): Promise<void> {
    const sources = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
    if (!Array.isArray(sources) || sources.length === 0) throw new Error('The official PYQ source manifest is empty.');
    await mkdir(outputDirectory, { recursive: true });
    // `npm run pyq:prepare -- <id> [<id> …]` limits the run; sources with a receipt are skipped.
    const only = new Set(process.argv.slice(2));
    for (const source of sources as Source[]) {
        if (only.size > 0 && !only.has(source.id)) continue;
        const base = source.id.replace(/[^a-zA-Z0-9._-]/g, '_');
        if (await readFile(resolve(outputDirectory, `${base}.receipt.json`)).then(() => true, () => false)) {
            console.log(JSON.stringify({ id: source.id, skipped: true, reason: 'Already downloaded (receipt present).' }));
            continue;
        }
        await download(source);
    }
    console.log(`Downloaded official source documents to ${outputDirectory}. No paper is import-eligible until its final answer key is reviewed.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
