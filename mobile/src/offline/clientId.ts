/**
 * Client-generated idempotency-key helper (task 21.9; Req 21.3).
 *
 * Every `Local_Sync_Record` captured offline is stamped with a client-generated UUID so the
 * Backend_API can reconcile it idempotently on `(userId, clientId)` (Req 21.5). This mirrors
 * the focus-timer's `generateClientId` but lives in the offline module so this task stays
 * self-contained (no cross-screen import).
 *
 * Prefers the platform `crypto.randomUUID` when present and degrades to an RFC-4122-shaped v4
 * string built from `Math.random` — sufficient as an idempotency key (it is not a security
 * token; uniqueness, not unpredictability, is what matters here).
 */
export function generateClientId(): string {
    const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (cryptoObj?.randomUUID) {
        return cryptoObj.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
        const rand = (Math.random() * 16) | 0;
        const value = char === 'x' ? rand : (rand & 0x3) | 0x8;
        return value.toString(16);
    });
}
