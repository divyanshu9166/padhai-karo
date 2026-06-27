/**
 * Shared auth/profile API DTOs (task 21.1).
 *
 * Mirror the Backend_API auth contract (Next.js API routes under `/api`). Feature-specific
 * DTOs live alongside their endpoint modules (`timetable.ts`, `offline.ts`, and the per-screen
 * `api.ts` files); this module holds the shapes the scaffold + auth flow need.
 */

/** Credentials for register/login. */
export interface Credentials {
  email: string;
  password: string;
}

/** The only user fields the backend exposes (mirrors backend `PublicUser`, Req 1.6). */
export interface PublicUser {
  id: string;
  email: string;
  /** ISO-8601 timestamp (serialized `Date`). */
  createdAt: string;
}

/** `POST /auth/register` (201) and `POST /auth/login` (200) response (Req 1.1, 1.4). */
export interface AuthTokenResponse {
  token: string;
  user: PublicUser;
}

/** `GET /auth/me` response — the authenticated user and onboarding completeness (Req 2.6). */
export interface AuthMeResponse {
  user: PublicUser;
  /** Whether the user has completed onboarding; drives the onboarding gate (Req 2.6). */
  profileComplete: boolean;
}
