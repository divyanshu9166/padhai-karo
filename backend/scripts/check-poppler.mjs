import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const binary = process.env.PDF_RENDERER_BIN?.trim() || (process.platform === 'win32' ? 'pdftoppm.cmd' : 'pdftoppm');
try {
    await run(binary, ['-h'], { windowsHide: true, timeout: 5000 });
    console.log(`PDF visual renderer ready: ${binary}`);
} catch (error) {
    console.error(`PDF visual renderer is not available: ${binary}`);
    console.error('Install Poppler (pdftoppm) or set PDF_RENDERER_BIN to its absolute executable path.');
    if (error instanceof Error) console.error(error.message);
    process.exitCode = 1;
}
