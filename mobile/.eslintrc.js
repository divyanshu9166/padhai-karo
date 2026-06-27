module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    parserOptions: { ecmaVersion: 2021, sourceType: 'module', ecmaFeatures: { jsx: true } },
    plugins: ['@typescript-eslint'],
    extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
    env: { es2021: true, node: true },
    ignorePatterns: ['node_modules/', '.expo/', 'babel.config.js', '*.config.js'],
    rules: {
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
    overrides: [
        {
            files: ['*.test.ts', '*.test.tsx'],
            env: { jest: true },
        },
    ],
};
