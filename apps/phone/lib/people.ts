import { displayNameFromEmail } from "@synergy/identity";
import { q } from "./db";
import { formatNumber, needE164, toE164 } from "./numbers";
import { UserError, cleanEmail, isEmail, text } from "./util";

export type Settings = {
  dnd: boolean;
  forwardTo: string | null;
  alsoRing: string | null;
  voicemail: boolean;
  ringSeconds: number;
  greetingText: string;
  hasGreetingAudio: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  dnd: false, forwardTo: null, alsoRing: null, voicemail: true, ringSeconds: 20, greetingText: "", hasGreetingAudio: false,
};

type SettingsRow = {
  dnd: boolean; forward_to: string | null; also_ring: string | null; voicemail: boolean; ring_seconds: number;
  greeting_text: string; has_audio: boolean;
};

export async function settingsOf(email: string): Promise<Settings> {
  const [r] = await q<SettingsRow>(
    `SELECT dnd, forward_to, also_ring, voicemail, ring_seconds, greeting_text, greeting_audio IS NOT NULL AS has_audio
     FROM settings WHERE email = $1`,
    [email.toLowerCase()],
  );
  if (!r) return { ...DEFAULT_SETTINGS };
  return {
    dnd: r.dnd, forwardTo: r.forward_to, alsoRing: r.also_ring, voicemail: r.voicemail, ringSeconds: r.ring_seconds,
    greetingText: r.greeting_text, hasGreetingAudio: r.has_audio,
  };
}

/** Forwarding goes to a colleague (email) or a phone number. */
function forwardTarget(v: unknown, me: string): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (isEmail(s)) {
    const e = cleanEmail(s);
    if (e === me) throw new UserError("Calls can't be forwarded to yourself");
    return e;
  }
  return needE164(s, "number or email to forward to");
}

export async function saveSettings(email: string, v: Partial<Record<keyof Settings, unknown>>): Promise<Settings> {
  const me = email.toLowerCase();
  const cur = await settingsOf(me);
  const next: Settings = {
    dnd: v.dnd === undefined ? cur.dnd : Boolean(v.dnd),
    forwardTo: v.forwardTo === undefined ? cur.forwardTo : forwardTarget(v.forwardTo, me),
    alsoRing: v.alsoRing === undefined ? cur.alsoRing : v.alsoRing ? needE164(v.alsoRing, "number to ring as well") : null,
    voicemail: v.voicemail === undefined ? cur.voicemail : Boolean(v.voicemail),
    ringSeconds: v.ringSeconds === undefined ? cur.ringSeconds : Math.round(Number(v.ringSeconds)),
    greetingText: v.greetingText === undefined ? cur.greetingText : text(v.greetingText, 400),
    hasGreetingAudio: cur.hasGreetingAudio,
  };
  if (!Number.isFinite(next.ringSeconds) || next.ringSeconds < 5 || next.ringSeconds > 60) {
    throw new UserError("Ring for between 5 and 60 seconds");
  }
  await q(
    `INSERT INTO settings (email, dnd, forward_to, also_ring, voicemail, ring_seconds, greeting_text, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (email) DO UPDATE SET dnd = $2, forward_to = $3, also_ring = $4, voicemail = $5, ring_seconds = $6,
       greeting_text = $7, updated_at = now()`,
    [me, next.dnd, next.forwardTo, next.alsoRing, next.voicemail, next.ringSeconds, next.greetingText],
  );
  return next;
}

export async function setGreetingAudio(email: string, wav: Buffer | null): Promise<void> {
  await q(
    `INSERT INTO settings (email, greeting_audio, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (email) DO UPDATE SET greeting_audio = $2, updated_at = now()`,
    [email.toLowerCase(), wav],
  );
}

export async function greetingAudio(email: string): Promise<Buffer | null> {
  const [r] = await q<{ greeting_audio: Buffer | null }>("SELECT greeting_audio FROM settings WHERE email = $1", [email.toLowerCase()]);
  return r?.greeting_audio ?? null;
}

/** Remembers who opened Phone, so others can find them by name. */
export async function touch(email: string, name: string): Promise<void> {
  await q(
    `INSERT INTO people (email, name, last_seen) VALUES ($1, $2, now())
     ON CONFLICT (email) DO UPDATE SET name = CASE WHEN $2 <> '' THEN $2 ELSE people.name END, last_seen = now()`,
    [email.toLowerCase(), name || displayNameFromEmail(email)],
  );
}

export async function nameOf(email: string): Promise<string> {
  const [r] = await q<{ name: string }>("SELECT name FROM people WHERE email = $1", [email.toLowerCase()]);
  return r?.name || displayNameFromEmail(email);
}

/** The number someone has, with the trunk calls out from it leave through. */
export type MyNumber = { number: string; trunkId: string; outboundId: string | null };

export async function numberOf(email: string): Promise<MyNumber | null> {
  const [r] = await q<{ number: string; trunk_id: string; lk_outbound_id: string | null }>(
    `SELECT n.number, n.trunk_id, t.lk_outbound_id FROM numbers n JOIN trunks t ON t.id = n.trunk_id WHERE n.assigned_to = $1`,
    [email.toLowerCase()],
  );
  return r ? { number: r.number, trunkId: r.trunk_id, outboundId: r.lk_outbound_id } : null;
}

export async function ownerOfNumber(e164: string): Promise<string | null> {
  const [r] = await q<{ assigned_to: string | null }>("SELECT assigned_to FROM numbers WHERE number = $1", [e164]);
  return r?.assigned_to ?? null;
}

export type DirectoryEntry = { email: string; name: string; number: string | null; numberLabel: string };

/** People to call, by name, email or number: everyone who has opened Phone or has a number. */
export async function directory(search: string, limit = 20): Promise<DirectoryEntry[]> {
  const s = search.trim().toLowerCase();
  const digits = s.replace(/\D/g, "");
  const rows = await q<{ email: string; name: string; number: string | null }>(
    `SELECT e.email, COALESCE(p.name, '') AS name, n.number
     FROM (SELECT email FROM people UNION SELECT assigned_to FROM numbers WHERE assigned_to IS NOT NULL) e(email)
     LEFT JOIN people p ON p.email = e.email
     LEFT JOIN numbers n ON n.assigned_to = e.email
     WHERE $1 = '' OR e.email LIKE '%' || $1 || '%' OR lower(p.name) LIKE '%' || $1 || '%'
        OR ($2 <> '' AND length($2) >= 3 AND n.number LIKE '%' || $2 || '%')
     ORDER BY COALESCE(NULLIF(p.name, ''), e.email)
     LIMIT $3`,
    [s, digits, limit],
  );
  return rows.map((r) => ({ email: r.email, name: r.name || displayNameFromEmail(r.email), number: r.number, numberLabel: formatNumber(r.number) }));
}

/** Who or what a typed destination is: a colleague (by email, or by their number) or an outside number. */
export type Target = { kind: "person"; email: string; viaNumber: string | null } | { kind: "number"; number: string };

export async function resolveTarget(raw: unknown): Promise<Target> {
  const s = String(raw ?? "").trim();
  if (isEmail(s)) return { kind: "person", email: cleanEmail(s), viaNumber: null };
  const n = toE164(s);
  if (!n) throw new UserError("Enter a name, email or phone number to call");
  const owner = await ownerOfNumber(n);
  return owner ? { kind: "person", email: owner, viaNumber: n } : { kind: "number", number: n };
}
