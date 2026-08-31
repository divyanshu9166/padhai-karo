import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { prisma } from '@/lib/db';
import { resolveSession } from '@/lib/auth';

const PATH = '/ws/community';
const clients = new Map<string, Set<WebSocket>>();

function send(socket: WebSocket, payload: Record<string, unknown>): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function addClient(userId: string, socket: WebSocket): void {
    const userClients = clients.get(userId) ?? new Set<WebSocket>();
    userClients.add(socket);
    clients.set(userId, userClients);
}

function removeClient(userId: string, socket: WebSocket): void {
    const userClients = clients.get(userId);
    if (!userClients) return;
    userClients.delete(socket);
    if (userClients.size === 0) clients.delete(userId);
}

export function broadcastCommunityMessage(message: { id: string; senderId: string; recipientId: string; body: string; readAt: Date | null; createdAt: Date; updatedAt: Date }): void {
    const payload = { type: 'message', message: { ...message, readAt: message.readAt?.toISOString() ?? null, createdAt: message.createdAt.toISOString(), updatedAt: message.updatedAt.toISOString() } };
    for (const userId of [message.senderId, message.recipientId]) for (const socket of clients.get(userId) ?? []) send(socket, payload);
}

function tokenFromRequest(request: IncomingMessage): string | null {
    const header = request.headers.authorization;
    if (header?.match(/^Bearer\s+\S+$/i)) return header.replace(/^Bearer\s+/i, '').trim();
    const queryToken = new URL(request.url ?? '/', 'http://localhost').searchParams.get('token');
    return queryToken?.trim() || null;
}

async function acceptedBuddy(userId: string, otherUserId: string): Promise<boolean> {
    const relation = await prisma.studyBuddy.findFirst({ where: { status: 'ACCEPTED', OR: [{ requesterId: userId, recipientId: otherUserId }, { requesterId: otherUserId, recipientId: userId }] }, select: { id: true } });
    return Boolean(relation);
}

async function handleMessage(userId: string, socket: WebSocket, raw: string): Promise<void> {
    let input: unknown;
    try { input = JSON.parse(raw); } catch { send(socket, { type: 'error', code: 'INVALID_JSON', message: 'Message must be valid JSON.' }); return; }
    if (!input || typeof input !== 'object') { send(socket, { type: 'error', code: 'VALIDATION_ERROR', message: 'Message payload must be an object.' }); return; }
    const data = input as Record<string, unknown>;
    if (data.type !== 'message' || typeof data.recipientId !== 'string' || typeof data.body !== 'string' || !data.body.trim() || data.body.trim().length > 4000) { send(socket, { type: 'error', code: 'VALIDATION_ERROR', message: 'Use type=message with recipientId and a body up to 4000 characters.' }); return; }
    const recipientId = data.recipientId.trim();
    if (!(await acceptedBuddy(userId, recipientId))) { send(socket, { type: 'error', code: 'FORBIDDEN', message: 'Messaging is available after a buddy request is accepted.' }); return; }
    const message = await prisma.communityMessage.create({ data: { senderId: userId, recipientId, body: data.body.trim() } });
    broadcastCommunityMessage(message);
}

/** Attach an authenticated community WebSocket endpoint to a long-lived Node HTTP server. */
export function attachCommunityWebSocket(server: HttpServer): void {
    const wss = new WebSocketServer({ noServer: true });
    const heartbeat = setInterval(() => {
        for (const socket of wss.clients) {
            if ((socket as WebSocket & { isAlive?: boolean }).isAlive === false) { socket.terminate(); continue; }
            (socket as WebSocket & { isAlive?: boolean }).isAlive = false;
            socket.ping();
        }
    }, 30_000);
    heartbeat.unref();
    server.once('close', () => { clearInterval(heartbeat); wss.close(); });
    server.on('upgrade', (request, socket, head) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        if (pathname !== PATH) return;
        wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, request));
    });
    wss.on('connection', async (socket: WebSocket, request: IncomingMessage) => {
        const session = await resolveSession(tokenFromRequest(request) ?? '');
        if (!session) { socket.close(1008, 'Authentication required.'); return; }
        const userId = session.user.id;
        addClient(userId, socket);
        (socket as WebSocket & { isAlive?: boolean }).isAlive = true;
        socket.on('pong', () => { (socket as WebSocket & { isAlive?: boolean }).isAlive = true; });
        send(socket, { type: 'ready', userId });
        socket.on('message', (raw) => { void handleMessage(userId, socket, raw.toString()); });
        socket.on('close', () => removeClient(userId, socket));
        socket.on('error', () => removeClient(userId, socket));
    });
}
