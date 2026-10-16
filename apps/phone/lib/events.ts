import pg from "pg";
import { q } from "./db";

/**
 * Live updates for each person's open Phone tabs: a call ringing, being answered elsewhere,
 * ending, a new voicemail. Sent with Postgres NOTIFY, so whichever process changes a call (a
 * browser's request, LiveKit's webhook, the voicemail worker) reaches every tab.
 */
export type PhoneEvent =
  | { type: "ring"; call: RingInfo }
  | { type: "ring-stop"; callId: string; reason: "answered" | "declined" | "ended" | "voicemail" | "missed" }
  | { type: "call"; callId: string; state: string; detail?: string }
  | { type: "voicemail"; id: string; from: string }
  | { type: "history" };

export type RingInfo = {
  id: string;
  room: string;
  from: string;
  fromName: string;
  fromNumber: string | null;
  /** The number that was dialled, for calls to someone's phone number. */
  toNumber: string | null;
  direction: "internal" | "inbound" | "outbound";
  /** Put through by someone else (a transfer or someone added to a call). */
  via: string | null;
};

const CHANNEL = "phone_events";

/** Sends an event to everyone in `to` (lower-case emails). */
export async function notify(to: string | string[], event: PhoneEvent): Promise<void> {
  const list = [...new Set((Array.isArray(to) ? to : [to]).filter(Boolean).map((e) => e.toLowerCase()))];
  for (const email of list) {
    await q("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify({ to: email, event })]);
  }
}

type Listener = (e: PhoneEvent) => void;
const g = globalThis as unknown as { __phoneListen?: { subs: Map<string, Set<Listener>>; client: Promise<pg.Client> | null } };

function state() {
  return (g.__phoneListen ??= { subs: new Map(), client: null });
}

function connect(): Promise<pg.Client> {
  const s = state();
  s.client ??= (async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:5499/phone" });
    const reset = () => {
      if (s.client) s.client = null;
      // Reconnect while anyone is still listening.
      if (s.subs.size) setTimeout(() => void connect().catch(() => {}), 2000);
    };
    client.on("error", (e) => {
      console.error("[phone] event listener lost its connection", e.message);
      reset();
    });
    client.on("end", reset);
    client.on("notification", (n) => {
      if (n.channel !== CHANNEL || !n.payload) return;
      try {
        const { to, event } = JSON.parse(n.payload) as { to: string; event: PhoneEvent };
        for (const fn of s.subs.get(to) ?? []) fn(event);
      } catch {
        /* not ours */
      }
    });
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    return client;
  })().catch((e) => {
    s.client = null;
    throw e;
  });
  return s.client;
}

/** Calls `fn` with each event for `email` until the returned function is called. */
export async function subscribe(email: string, fn: Listener): Promise<() => void> {
  const s = state();
  const key = email.toLowerCase();
  if (!s.subs.has(key)) s.subs.set(key, new Set());
  s.subs.get(key)!.add(fn);
  await connect();
  return () => {
    const set = s.subs.get(key);
    set?.delete(fn);
    if (set && !set.size) s.subs.delete(key);
  };
}
