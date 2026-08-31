import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { prisma } from '@/lib/db';
import type { AuthContext } from '@/lib/auth';
import { ErrorCode, errorResponse } from '@/lib/errors';

const MAX_SCALE = 2.5;
const DEFAULT_SCALE = 1.5;
const execFileAsync = promisify(execFile);

function rendererBinary(): string {
    return process.env.PDF_RENDERER_BIN || (process.platform === 'win32' ? 'pdftoppm.cmd' : 'pdftoppm');
}

/** Render one authenticated PDF page to a PNG for the mobile reader. */
export async function getPdfPageImageHandler(
    request: Request,
    auth: AuthContext,
    context: { params: { id: string; page: string } | Promise<{ id: string; page: string }> },
): Promise<Response> {
    const { id, page: pageParam } = await context.params;
    const pageNumber = Number.parseInt(pageParam, 10);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Page must be a positive integer.');
    const scaleParam = Number(new URL(request.url).searchParams.get('scale') ?? DEFAULT_SCALE);
    const scale = Number.isFinite(scaleParam) ? Math.min(MAX_SCALE, Math.max(0.75, scaleParam)) : DEFAULT_SCALE;
    const document = await prisma.pdfDocument.findFirst({ where: { id, userId: auth.user.id }, select: { fileData: true, fileChecksum: true, pageCount: true } });
    if (!document?.fileData) return errorResponse(404, ErrorCode.NOT_FOUND, 'PDF file is not available.');
    if (document.pageCount && pageNumber > document.pageCount) return errorResponse(404, ErrorCode.NOT_FOUND, 'PDF page not found.');
    try {
        // Poppler's native rasterizer is deliberately used here instead of a JS canvas
        // shim. It renders scanned pages, vector text, rotations and embedded fonts with
        // the same geometry as a desktop PDF reader. The binary is configurable for
        // Docker/Linux deployments and defaults to the bundled Windows executable name.
        const directory = await mkdtemp(`${tmpdir()}${process.platform === 'win32' ? '\\' : '/'}padhaikaro-pdf-`);
        const inputPath = `${directory}/document.pdf`;
        const outputPrefix = `${directory}/page`;
        try {
            await writeFile(inputPath, Buffer.from(document.fileData));
            await execFileAsync(rendererBinary(), [
                '-f', String(pageNumber),
                '-l', String(pageNumber),
                '-png',
                '-singlefile',
                '-r', String(Math.round(72 * scale)),
                '-aa', 'yes',
                '-aaVector', 'yes',
                inputPath,
                outputPrefix,
            ], { windowsHide: true, shell: process.platform === 'win32', timeout: 30_000, maxBuffer: 1024 * 1024 });
            const png = await readFile(`${outputPrefix}.png`);
            if (png.length === 0) throw new Error('PDF renderer returned an empty image.');
        return new Response(new Uint8Array(png), {
            headers: {
                'Content-Type': 'image/png',
                'Content-Length': String(png.length),
                'Cache-Control': 'private, max-age=86400',
                ETag: `"${document.fileChecksum ?? id}-${pageNumber}-${scale}"`,
            },
        });
        } finally {
            await rm(directory, { recursive: true, force: true }).catch(() => undefined);
        }
    } catch (error) {
        const message = error instanceof Error && /ENOENT|not found|not recognized/i.test(error.message)
            ? 'Native PDF rendering is not configured on this server. Install Poppler or set PDF_RENDERER_BIN.'
            : 'This PDF page could not be rendered.';
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, message);
    }
}
