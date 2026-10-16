/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 16 writes agent instruction files into the repo on every dev start; we keep our own.
  agentRules: false,
  // postgres.js is a server-only dependency; keep it out of any client bundle.
  serverExternalPackages: ['postgres'],
};
export default nextConfig;
