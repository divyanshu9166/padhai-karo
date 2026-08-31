/** @type {import('next').NextConfig} */
const nextConfig = {
    // Server-side-only API service: there is no web frontend.
    // React strict mode is harmless here and kept for any future internal tooling.
    reactStrictMode: true,
    // Keep Next/Turbopack anchored to this service when a parent workspace also
    // contains a lockfile (common on developer machines and CI runners).
    turbopack: { root: process.cwd() },
};

export default nextConfig;
