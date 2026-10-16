import crypto from "crypto";
import { pool, ensureSchema } from "./db";
import { buildIcs, type IcsMeeting } from "./ics";
import { sendInvite } from "./email";

export type Recurrence = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY";
  interval?: number;      // every N days/weeks/months (default 1)
  byday?: string[];       // for WEEKLY: ["MO","WE","FR"]
  count?: number;         // end after N occurrences
  until?: string;         // ISO date to end on (exclusive of the given end)
} | null;

export type Meeting = {
  id: string;
  room: string;
  title: string;
  description: string;
  host_email: string;
  host_name: string;
  start_at: string;
  duration_min: number;
  timezone: string;
  rrule: string | null;
  sequence: number;
  canceled_at: string | null;
  invitees: { email: string; name: string }[];
};

const BASE = process.env.MEET_PUBLIC_URL || `https://meet.${process.env.SUITE_DOMAIN}`;

export function roomUrl(room: string): string {
  return `${BASE}/room/${room}`;
}

/** Build an RFC5545 RRULE string from structured recurrence. */
export function toRrule(r: Recurrence): string | null {
  if (!r) return null;
  const parts = [`FREQ=${r.freq}`];
  if (r.interval && r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === "WEEKLY" && r.byday?.length) parts.push(`BYDAY=${r.byday.join(",")}`);
  if (r.count && r.count > 0) parts.push(`COUNT=${r.count}`);
  else if (r.until) parts.push(`UNTIL=${new Date(r.until).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
  return parts.join(";");
}

function slug(): string {
  return "s-" + crypto.randomBytes(4).toString("hex");
}

async function withInvitees(rows: any[]): Promise<Meeting[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const inv = await pool().query(
    `SELECT meeting_id, email, name FROM meeting_invitees WHERE meeting_id = ANY($1)`,
    [ids],
  );
  const byId = new Map<string, { email: string; name: string }[]>();
  for (const r of inv.rows) {
    (byId.get(r.meeting_id) ?? byId.set(r.meeting_id, []).get(r.meeting_id)!).push({ email: r.email, name: r.name });
  }
  return rows.map((r) => ({ ...r, start_at: new Date(r.start_at).toISOString(), invitees: byId.get(r.id) ?? [] }));
}

export async function listForHost(email: string): Promise<Meeting[]> {
  await ensureSchema();
  const { rows } = await pool().query(
    `SELECT * FROM meetings WHERE host_email = $1 ORDER BY start_at DESC LIMIT 200`,
    [email],
  );
  return withInvitees(rows);
}

export async function getMeeting(id: string): Promise<Meeting | null> {
  await ensureSchema();
  const { rows } = await pool().query(`SELECT * FROM meetings WHERE id = $1`, [id]);
  return (await withInvitees(rows))[0] ?? null;
}

export async function createMeeting(input: {
  title: string;
  description?: string;
  hostEmail: string;
  hostName: string;
  startAt: string;
  durationMin: number;
  timezone: string;
  recurrence: Recurrence;
  invitees: { email: string; name?: string }[];
}): Promise<Meeting> {
  await ensureSchema();
  const room = slug();
  const rrule = toRrule(input.recurrence);
  const { rows } = await pool().query(
    `INSERT INTO meetings (room, title, description, host_email, host_name, start_at, duration_min, timezone, rrule)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [room, input.title, input.description || "", input.hostEmail, input.hostName, input.startAt,
     input.durationMin, input.timezone, rrule],
  );
  const m = rows[0];
  const clean = dedupeInvitees(input.invitees);
  for (const i of clean) {
    await pool().query(
      `INSERT INTO meeting_invitees (meeting_id, email, name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [m.id, i.email, i.name || ""],
    );
  }
  return (await getMeeting(m.id))!;
}

export async function cancelMeeting(id: string): Promise<Meeting | null> {
  await ensureSchema();
  await pool().query(
    `UPDATE meetings SET canceled_at = now(), sequence = sequence + 1, updated_at = now() WHERE id = $1`,
    [id],
  );
  return getMeeting(id);
}

export async function rescheduleMeeting(id: string, input: {
  title?: string; description?: string; startAt?: string; durationMin?: number;
  timezone?: string; recurrence?: Recurrence; invitees?: { email: string; name?: string }[];
}): Promise<Meeting | null> {
  await ensureSchema();
  const cur = await getMeeting(id);
  if (!cur) return null;
  const rrule = input.recurrence !== undefined ? toRrule(input.recurrence) : cur.rrule;
  await pool().query(
    `UPDATE meetings SET title=$2, description=$3, start_at=$4, duration_min=$5, timezone=$6, rrule=$7,
       sequence = sequence + 1, updated_at = now() WHERE id=$1`,
    [id, input.title ?? cur.title, input.description ?? cur.description, input.startAt ?? cur.start_at,
     input.durationMin ?? cur.duration_min, input.timezone ?? cur.timezone, rrule],
  );
  if (input.invitees) {
    await pool().query(`DELETE FROM meeting_invitees WHERE meeting_id = $1`, [id]);
    for (const i of dedupeInvitees(input.invitees)) {
      await pool().query(
        `INSERT INTO meeting_invitees (meeting_id, email, name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [id, i.email, i.name || ""],
      );
    }
  }
  return getMeeting(id);
}

function dedupeInvitees(list: { email: string; name?: string }[]): { email: string; name?: string }[] {
  const seen = new Set<string>();
  const out: { email: string; name?: string }[] = [];
  for (const i of list) {
    const e = i.email.trim().toLowerCase();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !seen.has(e)) {
      seen.add(e);
      out.push({ email: e, name: i.name });
    }
  }
  return out;
}

/** Compose + send the invite (or update/cancel) email to every invitee. Returns per-address results. */
export async function dispatchInvites(m: Meeting, method: "REQUEST" | "CANCEL") {
  const url = roomUrl(m.room);
  const ics: IcsMeeting = {
    id: m.id, title: m.title, description: m.description,
    hostEmail: m.host_email, hostName: m.host_name,
    startAt: new Date(m.start_at), durationMin: m.duration_min,
    rrule: m.rrule, sequence: m.sequence, joinUrl: url, invitees: m.invitees,
  };
  const body = buildIcs(ics, method);
  const when = new Date(m.start_at).toLocaleString("en-US", {
    timeZone: m.timezone, dateStyle: "full", timeStyle: "short",
  });
  const verb = method === "CANCEL" ? "Cancelled" : "Invitation";
  const subject =
    method === "CANCEL" ? `Cancelled: ${m.title}` : `${m.title} — ${when}`;
  const recur = m.rrule ? `<p style="color:#94a3b8">Recurring: ${m.rrule}</p>` : "";
  const html =
    method === "CANCEL"
      ? `<div style="font-family:system-ui,sans-serif"><h2>Meeting cancelled</h2><p><b>${escapeHtml(m.title)}</b> on ${escapeHtml(when)} has been cancelled.</p></div>`
      : `<div style="font-family:system-ui,sans-serif;max-width:520px">
           <h2 style="margin:0 0 4px">${escapeHtml(m.title)}</h2>
           <p style="color:#64748b;margin:0 0 16px">${escapeHtml(when)} (${escapeHtml(m.timezone)}) · ${m.duration_min} min</p>
           ${m.description ? `<p>${escapeHtml(m.description)}</p>` : ""}
           ${recur}
           <p><a href="${url}" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Join the meeting</a></p>
           <p style="color:#94a3b8;font-size:13px">${url}</p>
           <p style="color:#94a3b8;font-size:12px">Hosted by ${escapeHtml(m.host_name || m.host_email)} · SynergyMeet</p>
         </div>`;
  const text =
    method === "CANCEL"
      ? `Cancelled: ${m.title} on ${when}.`
      : `${m.title}\n${when} (${m.timezone}) · ${m.duration_min} min\n${m.description || ""}\nJoin: ${url}`;

  const results: { email: string; sent: boolean; reason?: string }[] = [];
  for (const i of m.invitees) {
    const r = await sendInvite({ to: i.email, subject: `${verb === "Invitation" ? "" : ""}${subject}`, html, text, ics: body, method });
    results.push({ email: i.email, ...r });
  }
  return results;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
