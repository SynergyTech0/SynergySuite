import { ensureSchema, pool } from "./db";

/**
 * Saved meeting transcripts. The transcriber (lib/transcriber.ts) opens one transcript each time it
 * joins a room, records everyone who was there, and adds a segment per utterance, labelled with
 * the speaker. Signed-in people who were in the meeting can read it afterwards, and so can the host
 * and invitees of the scheduled meeting that uses the room.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS transcripts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room        text NOT NULL,
  title       text NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz
);
CREATE INDEX IF NOT EXISTS transcripts_room_idx ON transcripts (room, started_at DESC);

CREATE TABLE IF NOT EXISTS transcript_people (
  transcript_id uuid NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  identity      text NOT NULL,
  name          text NOT NULL DEFAULT '',
  email         text,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (transcript_id, identity)
);
CREATE INDEX IF NOT EXISTS transcript_people_email_idx ON transcript_people (email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS transcript_segments (
  id            bigserial PRIMARY KEY,
  transcript_id uuid NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  identity      text NOT NULL,
  name          text NOT NULL DEFAULT '',
  email         text,
  spoken_at     timestamptz NOT NULL,
  text          text NOT NULL
);
CREATE INDEX IF NOT EXISTS transcript_segments_idx ON transcript_segments (transcript_id, spoken_at);
`;

let ready: Promise<void> | null = null;

async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  await ensureSchema();
  if (!ready) {
    ready = pool().query(SCHEMA).then(() => undefined).catch((e) => {
      ready = null;
      throw e;
    });
  }
  await ready;
  return (await pool().query(text, params)).rows as T[];
}

/** "always": every meeting is transcribed. Anything else: only when a host turns it on. */
export function transcribeEveryMeeting(env: Record<string, string | undefined> = process.env): boolean {
  return (env.MEET_TRANSCRIBE || "").trim().toLowerCase() === "always";
}

/** Staff identities are their email; guests are "guest:Name#abcd"; phone legs and bots have their own. */
export function emailOf(identity: string): string | null {
  return /^[^\s@:]+@[^\s@]+\.[^\s@]+$/.test(identity) ? identity.toLowerCase() : null;
}

// Speech models make these up from silence, breathing and keyboard noise.
const PHANTOMS = new Set([
  "", "you", "thank you", "thanks", "thank you very much", "thanks for watching", "thank you for watching",
  "bye", "okay", "ok", "uh", "um", "hmm", "mm", "so", "subtitles by the amara.org community",
]);

/** The model's text, tidied; null when it is nothing worth keeping. */
export function cleanText(text: string): string | null {
  const t = text.replace(/\s+/g, " ").trim();
  const bare = t.toLowerCase().replace(/[^\p{L}\p{N}. ]/gu, "").replace(/\.+$/, "").trim();
  if (PHANTOMS.has(bare)) return null;
  if (/^\[.*\]$|^\(.*\)$/.test(t)) return null; // [Music], (silence)
  return t;
}

export async function openTranscript(room: string): Promise<string> {
  const [m] = await q<{ title: string }>(
    `SELECT title FROM meetings WHERE room = $1 AND canceled_at IS NULL ORDER BY start_at DESC LIMIT 1`,
    [room.split("__b")[0]],
  );
  const breakout = room.includes("__b") ? ` (breakout ${room.split("__b")[1]})` : "";
  const [row] = await q<{ id: string }>(`INSERT INTO transcripts (room, title) VALUES ($1, $2) RETURNING id`, [room, (m?.title || room) + breakout]);
  return row.id;
}

export async function closeTranscript(id: string): Promise<void> {
  // A meeting where nobody said anything leaves nothing behind.
  await q(`DELETE FROM transcripts t WHERE t.id = $1 AND NOT EXISTS (SELECT 1 FROM transcript_segments s WHERE s.transcript_id = t.id)`, [id]);
  await q(`UPDATE transcripts SET ended_at = now() WHERE id = $1`, [id]);
}

export async function addPerson(id: string, identity: string, name: string): Promise<void> {
  await q(
    `INSERT INTO transcript_people (transcript_id, identity, name, email) VALUES ($1, $2, $3, $4)
     ON CONFLICT (transcript_id, identity) DO UPDATE SET name = EXCLUDED.name`,
    [id, identity, name, emailOf(identity)],
  );
}

export async function addSegment(id: string, s: { identity: string; name: string; spokenAt: Date; text: string }): Promise<void> {
  await q(
    `INSERT INTO transcript_segments (transcript_id, identity, name, email, spoken_at, text) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, s.identity, s.name, emailOf(s.identity), s.spokenAt, s.text],
  );
  await q(`UPDATE transcripts SET ended_at = NULL WHERE id = $1`, [id]);
}

export type TranscriptSummary = { id: string; room: string; title: string; started_at: string; ended_at: string | null; people: string[]; segments: number };
export type Segment = { name: string; email: string | null; spoken_at: string; text: string };

/** Who may read a transcript: someone who was in it, or the scheduled meeting's host or invitees. */
const CAN_READ = `(
  EXISTS (SELECT 1 FROM transcript_people p WHERE p.transcript_id = t.id AND p.email = $1)
  OR EXISTS (SELECT 1 FROM meetings m WHERE m.room = split_part(t.room, '__b', 1) AND m.canceled_at IS NULL
             AND (lower(m.host_email) = $1 OR EXISTS (SELECT 1 FROM meeting_invitees i WHERE i.meeting_id = m.id AND lower(i.email) = $1))))`;

export async function listTranscripts(email: string, limit = 100): Promise<TranscriptSummary[]> {
  return q<TranscriptSummary>(
    `SELECT t.id, t.room, t.title, t.started_at, t.ended_at,
       COALESCE((SELECT array_agg(p.name ORDER BY p.joined_at) FROM transcript_people p WHERE p.transcript_id = t.id), '{}') AS people,
       (SELECT count(*)::int FROM transcript_segments s WHERE s.transcript_id = t.id) AS segments
     FROM transcripts t WHERE ${CAN_READ}
     ORDER BY t.started_at DESC LIMIT $2`,
    [email.toLowerCase(), limit],
  );
}

export async function getTranscript(email: string, id: string): Promise<(TranscriptSummary & { segments_list: Segment[] }) | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [t] = await q<TranscriptSummary>(
    `SELECT t.id, t.room, t.title, t.started_at, t.ended_at,
       COALESCE((SELECT array_agg(p.name ORDER BY p.joined_at) FROM transcript_people p WHERE p.transcript_id = t.id), '{}') AS people,
       0 AS segments
     FROM transcripts t WHERE t.id = $2 AND ${CAN_READ}`,
    [email.toLowerCase(), id],
  );
  if (!t) return null;
  const segs = await q<Segment>(
    `SELECT name, email, spoken_at, text FROM transcript_segments WHERE transcript_id = $1 ORDER BY spoken_at, id`,
    [id],
  );
  return { ...t, segments: segs.length, segments_list: segs };
}

/** Plain text, one line per utterance: "[14:03] Dana: text". */
export function asText(t: { title: string; started_at: string }, segs: Segment[], timeZone = "UTC"): string {
  const time = (d: string) => new Date(d).toLocaleTimeString("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });
  const head = `${t.title}\n${new Date(t.started_at).toLocaleString("en-US", { timeZone, dateStyle: "full", timeStyle: "short" })}\n\n`;
  return head + segs.map((s) => `[${time(s.spoken_at)}] ${s.name}: ${s.text}`).join("\n") + "\n";
}
