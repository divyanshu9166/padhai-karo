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

/** `POST /auth/password-reset/request` → 200 generic message; emails a 6-digit code if the account exists. */
export function requestPasswordReset(email: string): Promise<{ message: string }> {
    return request<{ message: string }>('/auth/password-reset/request', { method: 'POST', body: { email } });
}

/** `POST /auth/password-reset/confirm` → `{ token, user }`; signs in with the new password. */
export function confirmPasswordReset(input: { email: string; code: string; newPassword: string }): Promise<AuthTokenResponse> {
    return request<AuthTokenResponse>('/auth/password-reset/confirm', { method: 'POST', body: input });
}

/** `POST /auth/logout` → 204 (Req 1). */
export function logoutUser(): Promise<void> {
    return request<void>('/auth/logout', { method: 'POST' });
}

/** `GET /auth/me` → `{ user, profileComplete }`; drives onboarding gating (Req 2.6). */
export function fetchMe(): Promise<AuthMeResponse> {
    return request<AuthMeResponse>('/auth/me');
}

/** Permanently delete the authenticated account after explicit confirmation and password proof. */
export function deleteAccount(password: string, confirmation: string): Promise<void> {
    return request<void>('/account/delete', {
        method: 'DELETE',
        body: { confirmation, password },
    });
}
