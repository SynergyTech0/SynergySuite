/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 16 writes AGENTS.md/CLAUDE.md into the repo on every dev start; we keep our own.
  agentRules: false,
};
export default nextConfig;
