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

async function download(source: Source): Promise<void> {
    assertOfficialUrl(source.sourcePageUrl, `${source.id}.sourcePageUrl`);
    if (!source.downloadUrl) {
        console.log(JSON.stringify({ id: source.id, skipped: true, reason: 'No public download URL; complete the official candidate/login flow.' }));
        return;
    }
    const url = assertOfficialUrl(source.downloadUrl, `${source.id}.downloadUrl`);
    const response = await fetch(url, { redirect: 'error', headers: { Accept: 'application/pdf,application/octet-stream' } });
    if (!response.ok) throw new Error(`${source.id}: official download returned HTTP ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > maxBytes) throw new Error(`${source.id}: download size is outside the safe limit.`);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const base = source.id.replace(/[^a-zA-Z0-9._-]/g, '_');
    const documentPath = resolve(outputDirectory, `${base}.pdf`);
    let answerKeyPath: string | undefined;
    let answerKeyChecksum: string | undefined;
    let answerKeyBytes: number | undefined;
    if (source.answerKeyUrl) {
        const answerKeyUrl = assertOfficialUrl(source.answerKeyUrl, `${source.id}.answerKeyUrl`);
        const answerKeyResponse = await fetch(answerKeyUrl, { redirect: 'error', headers: { Accept: 'application/pdf,application/octet-stream' } });
        if (!answerKeyResponse.ok) throw new Error(`${source.id}: official answer-key download returned HTTP ${answerKeyResponse.status}.`);
        const answerKey = Buffer.from(await answerKeyResponse.arrayBuffer());
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
    for (const source of sources as Source[]) await download(source);
    console.log(`Downloaded official source documents to ${outputDirectory}. No paper is import-eligible until its final answer key is reviewed.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
