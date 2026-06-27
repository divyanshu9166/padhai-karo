/**
 * Jest config for the Expo client (task 21.1).
 *
 * Uses the `jest-expo` preset so RN/Expo modules (e.g. expo-constants) resolve and transform
 * under test, and maps the `@/*` path alias to `src/*` to mirror tsconfig. We intentionally do
 * NOT override `transformIgnorePatterns` — the preset ships a comprehensive default that
 * transforms the Expo/React Native ESM modules.
 */
module.exports = {
    preset: 'jest-expo',
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
    testMatch: ['**/*.test.ts', '**/*.test.tsx'],
};
