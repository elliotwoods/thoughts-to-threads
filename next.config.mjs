/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // firebase-admin (and its transitive deps) must not be bundled; keep it
  // external so it runs on the Node.js runtime, never the edge.
  // (Renamed from experimental.serverComponentsExternalPackages in Next 15.)
  serverExternalPackages: ["firebase-admin"],
};

export default nextConfig;
