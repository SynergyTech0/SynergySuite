/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // collaborative editor mounts once; strict double-mount fights the provider
  eslint: { ignoreDuringBuilds: true },
};
export default nextConfig;
