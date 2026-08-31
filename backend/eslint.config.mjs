import nextConfig from 'eslint-config-next';

/**
 * Next 16 removed `next lint` and its legacy `.eslintrc` loader. Keep the
 * backend lint command on the supported flat-config path while retaining the
 * same Next/TypeScript rules the project used before the upgrade.
 */
const config = [...nextConfig];

export default config;
