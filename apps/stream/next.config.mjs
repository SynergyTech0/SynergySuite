/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 16 writes agent instruction files into the repo on every dev start; we keep our own.
  agentRules: false,
  async headers() {
    // The engine's page loads its .wasm and .js with ?v=<build hash>, so those can be cached for
    // good; only the page itself must revalidate.
    return [
      { source: "/engine/:file*.:ext(wasm|js)", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/engine/index.html", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
};
export default nextConfig;
