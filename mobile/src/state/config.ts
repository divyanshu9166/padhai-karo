/**
 * Backwards-compatible configuration export.
 *
 * `config/env` is deliberately the only endpoint resolver: it validates HTTPS/WSS in
 * production. Keeping this legacy state-level import as a re-export prevents an older
 * caller from silently bypassing that validation.
 */
export { API_BASE_URL } from '@/config/env';
