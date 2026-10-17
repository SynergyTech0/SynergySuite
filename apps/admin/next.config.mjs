/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 16 writes agent instruction files into the repo on every dev start; we keep our own.
  agentRules: false,
  // The IMAP client (mail import from other servers) is Node-only; keep it out of the bundler.
  serverExternalPackages: ["imapflow"],
};
export default nextConfig;
