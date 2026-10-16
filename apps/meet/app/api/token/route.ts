import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import crypto from "crypto";
import { getServerSession } from "@/lib/session";
import { livekitWsUrl } from "@/lib/livekit";

/**
 * Mint short-lived TURN credentials for our coturn server (use-auth-secret / ephemeral scheme).
 * Remote clients behind symmetric NAT can only receive media via a TURN relay; LiveKit's embedded
 * TURN was unreliable, so we run coturn and hand the browser these creds to put in rtcConfig.
 * username = "<expiryUnix>:<id>", password = base64(HMAC-SHA1(secret, username)).
 */
function turnIceServers(id: string) {
  const secret = process.env.TURN_STATIC_SECRET;
  const turnIp = process.env.TURN_HOST;
  if (!secret || !turnIp) return undefined;
  const ttl = 60 * 60 * 6; // 6h
  const username = `${Math.floor(Date.now() / 1000) + ttl}:${id}`;
  const credential = crypto.createHmac("sha1", secret).update(username).digest("base64");
  // Run TURN on a different public IP from the LiveKit server. Co-locating TURN + SFU on one IP made
  // relayed media hairpin back to the same host and the connection wouldn't hold; a distinct relay IP
  // fixes it. Plain turn: (not turns:) is fine in rtcConfig from an HTTPS page — TURN URLs aren't
  // subject to mixed-content blocking; TCP transport survives symmetric NAT.
  return [
    { urls: `stun:${turnIp}:3478` },
    {
      urls: [`turn:${turnIp}:3478?transport=udp`, `turn:${turnIp}:3478?transport=tcp`],
      username,
      credential,
    },
  ];
}

export const dynamic = "force-dynamic";

/**
 * Mint a LiveKit join token. This is the ONLY thing that decides who gets into a room, so the
 * two-identity rule is enforced HERE, server-side — never trust the client's claimed identity.
 *
 *   - STAFF: must have a SynergyAuth session. Identity = their real email; they may create rooms.
 *   - GUEST: no session. Allowed only with a display name, and only to JOIN an existing room, never
 *     to create one. A guest's identity is namespaced (guest:<name>#<rand>) so it can never collide
 *     with or impersonate a staff member.
 *
 * The token is a short-lived JWT the browser hands to wss://meet.<SUITE_DOMAIN>; LiveKit verifies
 * it with the shared secret. The API secret never leaves the server.
 */
export async function POST(req: Request) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    return NextResponse.json({ error: "Meeting server is not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const room = String(body.room || "").trim();
  if (!room || !/^[a-zA-Z0-9_-]{1,64}$/.test(room)) {
    return NextResponse.json({ error: "Invalid room name" }, { status: 400 });
  }

  const session = await getServerSession();
  const isStaff = Boolean(session?.user?.email);

  let identity: string;
  let name: string;
  let canPublish = true;

  if (isStaff) {
    identity = session!.user!.email!;
    name = session!.user!.name || session!.user!.email!;
  } else {
    // Guest path — mirrors a signer opening a tokenised link.
    const guestName = String(body.guestName || "").trim().slice(0, 48);
    if (!guestName) {
      return NextResponse.json(
        { error: "A display name is required to join as a guest" },
        { status: 401 },
      );
    }
    // Random suffix: two guests named "Sam" get distinct identities, and no guest can claim a
    // staff email as their identity.
    const suffix = cryptoRandom(4);
    identity = `guest:${guestName}#${suffix}`;
    name = guestName;
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name,
    ttl: "2h",
  });
  at.addGrant({
    room,
    roomJoin: true,
    // Only staff may bring a room into being; a guest joining a non-existent room simply lands in an
    // empty room, which is fine — they cannot conjure one to squat a name.
    roomCreate: isStaff,
    canPublish,
    canSubscribe: true,
    canPublishData: true,
  });

  const token = await at.toJwt();
  return NextResponse.json({
    token,
    url: livekitWsUrl(),
    identity,
    isStaff,
    iceServers: turnIceServers(identity),
  });
}

function cryptoRandom(n: number): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
