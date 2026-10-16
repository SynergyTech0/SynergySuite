/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 16 writes agent rule files into the app on every dev start; the repo keeps its own.
  agentRules: false,
};
export default nextConfig;
