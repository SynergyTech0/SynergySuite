/**
 * Where Meet finds its LiveKit media server.
 *
 *  - apiUrl: the server API (rooms, recording), called from this server. In the suite's compose
 *    file that is the livekit service on the internal network (LIVEKIT_API_URL); without it, the
 *    public address through the gateway.
 *  - wsUrl: what the browser connects to. LIVEKIT_WS_URL or NEXT_PUBLIC_LIVEKIT_URL, else
 *    wss://meet.<SUITE_DOMAIN>, where the gateway passes /rtc on to the media server. Read at run
 *    time, so the same image works under any domain.
 */
type Env = Record<string, string | undefined>;

export function livekitApiUrl(env: Env = process.env): string {
  return env.LIVEKIT_API_URL || `https://meet.${env.SUITE_DOMAIN}`;
}

export function livekitWsUrl(env: Env = process.env): string | undefined {
  const explicit = env.LIVEKIT_WS_URL || env["NEXT_PUBLIC_LIVEKIT_URL"];
  if (explicit) return explicit;
  return env.SUITE_DOMAIN ? `wss://meet.${env.SUITE_DOMAIN}` : undefined;
}
