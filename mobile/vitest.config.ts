import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Vitest config for the mobile client's pure-logic tests (task 21.1 + feature tasks).
 *
 * Scope: framework-free modules only — the API client, the localization resolver, the
 * dashboard helpers, the onboarding validation, and the offline outbox/sync/scoring logic —
 * run here in a Node environment with no React Native runtime dependency. `globals: true`
 * provides the `describe/it/expect` globals the test files use (typed via
 * `src/vitest-env.d.ts`). Component/render tests would use jest-expo + React Native Testing
 * Library separately.
 *
 * The `@` alias mirrors the TS path map so the few modules that reference `@/api` resolve in
 * tests; those that pull in React Native / Expo at runtime are replaced with `vi.mock` in the
 * individual test files.
 */
export default defineConfig({
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.test.ts'],
    },
});
