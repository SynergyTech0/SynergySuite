/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 16 writes agent instruction files into the repo on every dev start; we keep our own.
  agentRules: false,
  // Node-only mail library; keep it out of the bundler.
  serverExternalPackages: ["nodemailer"],
};
export default nextConfig;
