/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 16 writes AGENTS.md/CLAUDE.md into the repo on every dev start; we keep our own.
  agentRules: false,
  async headers() {
    // The engine's .wasm and .js names carry a content hash; only its page must revalidate.
    // The DWG converter's names don't, so it revalidates too.
    return [
      { source: "/engine/index.html", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      { source: "/dwg/:file*", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      // Chili3D's bundle names are mostly unhashed (main.js), so all of it revalidates.
      { source: "/engine3d/:file*", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
};
export default nextConfig;
