/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 16 writes agent instruction files into the repo on every dev start; we keep our own.
  agentRules: false,
  async headers() {
    // draw.io's editor is static and versioned by the image; let browsers keep it.
    return [{ source: "/drawio/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] }];
  },
};
export default nextConfig;
