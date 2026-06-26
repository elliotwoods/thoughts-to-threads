/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // firebase-admin (and its transitive deps) must not be bundled; keep it
    // external so it runs on the Node.js runtime, never the edge.
    serverComponentsExternalPackages: ["firebase-admin"],
  },
};

export default nextConfig;
