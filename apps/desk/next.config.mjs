/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 16 writes agent instruction files into the repo on every dev start; we keep our own.
  agentRules: false,
  // IMAP and MIME libraries are Node-only; keep them out of the bundler.
  serverExternalPackages: ["imapflow", "mailparser", "nodemailer"],
};
export default nextConfig;
