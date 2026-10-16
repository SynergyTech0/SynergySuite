/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 16 writes AGENTS.md/CLAUDE.md into the repo on every dev start; we keep our own.
  agentRules: false,
  async headers() {
    // The engine's .wasm and .js names carry a content hash; only its page must revalidate.
    return [{ source: "/engine/index.html", headers: [{ key: "Cache-Control", value: "no-cache" }] }];
  },
};
export default nextConfig;
