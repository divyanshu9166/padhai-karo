/**
 * Auth endpoint helpers (design "Auth Service", Req 1).
 *
 * Thin typed wrappers over the generic {@link request} client for the auth surface the
 * scaffold needs to drive onboarding gating (Req 2.6). Consumed by AuthContext and the
 * login/register screens (task 21.2).
 */
import { request } from './client';
import type { AuthMeResponse, AuthTokenResponse, Credentials } from './types';

/** `POST /auth/register` → `{ token, user }` (Req 1.1). */
export function registerUser(credentials: Credentials): Promise<AuthTokenResponse> {
    return request<AuthTokenResponse>('/auth/register', { method: 'POST', body: credentials });
}

/** `POST /auth/login` → `{ token, user }` (Req 1.4). */
export function loginUser(credentials: Credentials): Promise<AuthTokenResponse> {
    return request<AuthTokenResponse>('/auth/login', { method: 'POST', body: credentials });
}

/** `POST /auth/logout` → 204 (Req 1). */
export function logoutUser(): Promise<void> {
    return request<void>('/auth/logout', { method: 'POST' });
}

/** `GET /auth/me` → `{ user, profileComplete }`; drives onboarding gating (Req 2.6). */
export function fetchMe(): Promise<AuthMeResponse> {
    return request<AuthMeResponse>('/auth/me');
}
