import http from 'node:http';
import next from 'next';
import { attachCommunityWebSocket } from './src/realtime/communitySocket';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT || 3000);
const app = next({ dev });
const handle = app.getRequestHandler();

async function main(): Promise<void> {
    await app.prepare();
    const server = http.createServer((request, response) => { void handle(request, response); });
    attachCommunityWebSocket(server);
    server.listen(port, () => console.log(`PadhaiKaro HTTP + WebSocket server listening on ${port}`));

    const shutdown = (): void => { server.close(() => process.exit(0)); };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
}

void main().catch((error: unknown) => {
    console.error('PadhaiKaro server failed to start.', error);
    process.exitCode = 1;
});
