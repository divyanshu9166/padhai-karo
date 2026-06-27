/**
 * Generic typed HTTP client for the Backend_API (task 21.1).
 *
 * A single low-level {@link request} function that every feature's endpoint wrappers build on
 * (see `auth.ts`, `timetable.ts`, `offline.ts`, and the per-screen `api.ts` modules). It:
 *
 *   - prefixes each path with the configured {@link API_BASE_URL} (from app config /
 *     expo-constants — see `config/env.ts`);
 *   - attaches the session token as an `Authorization: Bearer <token>` header when one has
 *     been set via {@link setAuthToken} (Req 1.7); the AuthContext sets/clears it on
 *     sign-in/out and on startup;
 *   - serializes a JSON body and sets `Content-Type` when a body is provided;
 *   - parses the JSON response and, on a non-2xx status, throws a typed {@link ApiError}
 *     carrying the backend's stable error `code` (see backend `ErrorCode`) so callers and the
 *     localization layer can branch on the failure.
 *
 * It is free of React Native imports so its logic is unit-testable in plain Node (see
 * `client.test.ts`); `fetch` is taken from the global scope (provided by RN at runtime).
 */

import { API_BASE_URL } from '@/config/env';

/** The session token used for the `Authorization` header; `null` when unauthenticated. */
let authToken: string | null = null;

/**
 * Set (or clear with `null`) the bearer token attached to subsequent requests (Req 1.7).
 * Called by the AuthContext after sign-in, on startup once the stored token is loaded, and on
 * sign-out.
 */
export function setAuthToken(token: string | null): void {
    authToken = token;
}

/** The current bearer token, primarily for diagnostics/tests. */
export function getAuthToken(): string | null {
    return authToken;
}

/** Options accepted by {@link request}. */
export interface RequestOptions {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    /** JSON-serializable request body; sent with a `Content-Type: application/json` header. */
    body?: unknown;
    /** Optional abort signal for cancellation (used by connectivity probes and screens). */
    signal?: AbortSignal;
}

/** A typed error thrown for any non-2xx response or transport failure. */
export class ApiError extends Error {
    /** HTTP status code (0 for transport/parse failures). */
    readonly status: number;
    /** Stable backend error code (e.g. `UNAUTHORIZED`), or a synthetic code for transport. */
    readonly code: string;
    /** Optional structured details from the error envelope (e.g. unmet password requirement). */
    readonly details?: unknown;

    constructor(status: number, code: string, message: string, details?: unknown) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

/** Join the base URL and a path with exactly one slash between them. */
function buildUrl(path: string): string {
    const base = API_BASE_URL.replace(/\/+$/, '');
    const suffix = path.replace(/^\/+/, '');
    return `${base}/${suffix}`;
}

/** Narrow an arbitrary parsed body to the shared error-envelope shape. */
function asErrorEnvelope(
    body: unknown,
): { code: string; message: string; details?: unknown } | null {
    if (
        typeof body === 'object' &&
        body !== null &&
        'error' in body &&
        typeof (body as { error: unknown }).error === 'object' &&
        (body as { error: unknown }).error !== null
    ) {
        const err = (body as { error: Record<string, unknown> }).error;
        if (typeof err.code === 'string' && typeof err.message === 'string') {
            return { code: err.code, message: err.message, details: err.details };
        }
    }
    return null;
}

/**
 * Perform a request to `path` (relative to {@link API_BASE_URL}) and return the parsed JSON
 * body typed as `T`. Throws {@link ApiError} on a non-2xx response or a transport failure. A
 * `204 No Content` (or empty body) resolves to `undefined`.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, signal } = options;

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
    }

    let serializedBody: string | undefined;
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        serializedBody = JSON.stringify(body);
    }

    let response: Response;
    try {
        response = await fetch(buildUrl(path), {
            method,
            headers,
            body: serializedBody,
            signal,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Network request failed';
        throw new ApiError(0, 'NETWORK_ERROR', message);
    }

    if (response.status === 204) {
        return undefined as T;
    }

    let parsed: unknown = undefined;
    const rawText = await response.text();
    if (rawText.length > 0) {
        try {
            parsed = JSON.parse(rawText);
        } catch {
            parsed = undefined;
        }
    }

    if (!response.ok) {
        const envelope = asErrorEnvelope(parsed);
        if (envelope) {
            throw new ApiError(response.status, envelope.code, envelope.message, envelope.details);
        }
        throw new ApiError(
            response.status,
            'HTTP_ERROR',
            `Request failed with status ${response.status}`,
        );
    }

    return parsed as T;
}
