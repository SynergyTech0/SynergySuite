/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 16 writes agent instruction files into the repo on every dev start; we keep our own.
  agentRules: false,
  // The voicemail worker's media library is native code; load it from node_modules, not the bundle.
  serverExternalPackages: ["@livekit/rtc-node", "@livekit/rtc-ffi-bindings"],
};
export default nextConfig;
