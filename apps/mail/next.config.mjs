/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // IMAP and MIME libraries are Node-only; keep them out of the bundler.
  serverExternalPackages: ["imapflow", "mailparser", "nodemailer"],
};
export default nextConfig;
