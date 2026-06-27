/** @type {import('next').NextConfig} */
const nextConfig = {
    // Server-side-only API service: there is no web frontend.
    // React strict mode is harmless here and kept for any future internal tooling.
    reactStrictMode: true,
};

export default nextConfig;
