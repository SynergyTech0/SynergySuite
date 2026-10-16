import crypto from "node:crypto";
import { AccessToken, RoomServiceClient, SipClient, WebhookReceiver } from "livekit-server-sdk";
import { UserError } from "./util";

/**
 * Calls run on the same LiveKit media server as Meet (same keys, same settings), so a call can
 * become a meeting without anyone hanging up. Calls to and from real phone numbers go through
 * LiveKit's SIP service, which sits next to the media server (see deploy/ in this app).
 */
export type LiveKitConfig = { apiKey: string; apiSecret: string; apiUrl: string; wsUrl: string };

export function livekitConfig(env: NodeJS.ProcessEnv = process.env): LiveKitConfig | null {
  const apiKey = env.LIVEKIT_API_KEY || "";
  const apiSecret = env.LIVEKIT_API_SECRET || "";
  if (!apiKey || !apiSecret) return null;
  const domain = env.SUITE_DOMAIN;
  const apiUrl = env.LIVEKIT_API_URL || (domain ? `https://meet.${domain}` : "http://localhost:7880");
  const wsUrl = env.NEXT_PUBLIC_LIVEKIT_URL || env.LIVEKIT_WS_URL || apiUrl.replace(/^http/, "ws");
  return { apiKey, apiSecret, apiUrl, wsUrl };
}

export function needLivekit(): LiveKitConfig {
  const c = livekitConfig();
  if (!c) throw new UserError("Calling isn't set up yet: the media server keys (LIVEKIT_API_KEY, LIVEKIT_API_SECRET) are missing", 503);
  return c;
}

const g = globalThis as unknown as { __phoneLk?: { rooms: RoomServiceClient; sip: SipClient; hooks: WebhookReceiver; key: string } };

function clients() {
  const c = needLivekit();
  const key = `${c.apiUrl}|${c.apiKey}`;
  if (!g.__phoneLk || g.__phoneLk.key !== key) {
    g.__phoneLk = {
      key,
      rooms: new RoomServiceClient(c.apiUrl, c.apiKey, c.apiSecret),
      sip: new SipClient(c.apiUrl, c.apiKey, c.apiSecret),
      hooks: new WebhookReceiver(c.apiKey, c.apiSecret),
    };
  }
  return g.__phoneLk;
}

export const rooms = () => clients().rooms;
export const sip = () => clients().sip;
export const webhooks = () => clients().hooks;

/** A room name for a new call: call-<random>. Meet accepts it as a room name too. */
export function newRoomName(prefix = "call"): string {
  return `${prefix}-${crypto.randomBytes(9).toString("base64url").replace(/[^a-zA-Z0-9]/g, "x")}`;
}

/** A join token for a person in a call room. Their identity is their email, as in Meet. */
export async function joinToken(room: string, who: { email: string; name: string }, ttl = "4h"): Promise<string> {
  const c = needLivekit();
  const at = new AccessToken(c.apiKey, c.apiSecret, { identity: who.email, name: who.name, ttl });
  at.addGrant({ room, roomJoin: true, roomCreate: true, canPublish: true, canSubscribe: true, canPublishData: true });
  return at.toJwt();
}

/**
 * Short-lived credentials for the suite's TURN relay (TURN_HOST, TURN_STATIC_SECRET), as Meet
 * hands out, for people behind firewalls that block the media server's UDP ports.
 */
export function turnIceServers(id: string, env: NodeJS.ProcessEnv = process.env): RTCIceServerLike[] | undefined {
  const secret = env.TURN_STATIC_SECRET;
  const host = env.TURN_HOST;
  if (!secret || !host) return undefined;
  const username = `${Math.floor(Date.now() / 1000) + 6 * 3600}:${id}`;
  const credential = crypto.createHmac("sha1", secret).update(username).digest("base64");
  return [
    { urls: `stun:${host}:3478` },
    { urls: [`turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`], username, credential },
  ];
}
export type RTCIceServerLike = { urls: string | string[]; username?: string; credential?: string };

/** Identity of a phone number in a room. */
export const numberIdentity = (e164: string) => `tel:${e164}`;
/** Identity of the voicemail and ringback worker. */
export const AGENT_IDENTITY = "phone-agent";

/** Ends a call for everyone in it. A room that is already gone is fine. */
export async function closeRoom(room: string): Promise<void> {
  try {
    await rooms().deleteRoom(room);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (!/not.?found|404/i.test(msg)) console.error("[phone] could not close room", room, msg);
  }
}

/** Takes one participant out of a room (a phone number that stopped ringing, someone transferred away). */
export async function removeFromRoom(room: string, identity: string): Promise<void> {
  try {
    await rooms().removeParticipant(room, identity);
  } catch {
    /* already gone */
  }
}
