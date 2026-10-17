/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 16 writes agent instruction files into the repo on every dev start; we keep our own.
  agentRules: false,
  // CardDAV paths end in "/" (collections); proxy.ts answers them as they are.
  skipTrailingSlashRedirect: true,
};
export default nextConfig;
