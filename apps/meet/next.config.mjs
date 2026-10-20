/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The transcriber's media library is native code; load it from node_modules, not the bundle.
  serverExternalPackages: ["@livekit/rtc-node", "@livekit/rtc-ffi-bindings"],
};
export default nextConfig;
