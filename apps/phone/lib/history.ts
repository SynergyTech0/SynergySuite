import { holdChecker } from "./compliance";
import { q } from "./db";
import { formatNumber } from "./numbers";
import { UserError } from "./util";

/** A call as one person sees it in their history. */
export type HistoryItem = {
  id: string;
  /** From this person's side. */
  direction: "in" | "out";
  /** The other side: a colleague's email, or a phone number. */
  other: string;
  otherName: string;
  otherNumber: string | null;
  state: string;
  missed: boolean;
  reason: string | null;
  at: string;
  durationS: number | null;
  meeting: boolean;
  hasVoicemail: boolean;
};

type Row = {
  id: string; direction: string; from_email: string | null; from_number: string | null; from_name: string;
  to_email: string | null; to_number: string | null; to_name: string | null; state: string; end_reason: string | null;
  created_at: Date; answered_at: Date | null; ended_at: Date | null; answered_by: string | null; meeting: boolean;
  my_state: string | null; has_vm: boolean;
};

/** Calls this person made, took or was rung for, newest first, without the ones they removed. */
export async function historyFor(email: string, opts: { limit?: number; before?: string | null; missedOnly?: boolean } = {}): Promise<HistoryItem[]> {
  const me = email.toLowerCase();
  const rows = await q<Row>(
    `SELECT c.*, (SELECT name FROM people WHERE email = c.to_email) AS to_name,
       (SELECT p.state FROM parties p WHERE p.call_id = c.id AND p.email = $1 ORDER BY p.created_at DESC LIMIT 1) AS my_state,
       EXISTS (SELECT 1 FROM voicemails v WHERE v.call_id = c.id AND v.owner = $1 AND v.held_deleted_at IS NULL) AS has_vm
     FROM calls c
     WHERE (c.from_email = $1 OR c.to_email = $1 OR EXISTS (SELECT 1 FROM parties p WHERE p.call_id = c.id AND p.email = $1))
       AND c.held_deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM hidden_calls h WHERE h.call_id = c.id AND h.email = $1)
       AND ($2::timestamptz IS NULL OR c.created_at < $2)
     ORDER BY c.created_at DESC
     LIMIT $3`,
    [me, opts.before ? new Date(opts.before) : null, Math.min(200, opts.limit ?? 60)],
  );
  const items = rows.map((r): HistoryItem => {
    const out = r.from_email === me;
    const other = out ? r.to_email ?? r.to_number ?? "" : r.from_email ?? r.from_number ?? "";
    const otherName = out
      ? r.to_name || (r.to_email ? r.to_email : formatNumber(r.to_number))
      : r.from_name || (r.from_email ? r.from_email : formatNumber(r.from_number)) || "Unknown caller";
    // Rang for them and nobody picked up (including calls that went to voicemail).
    const missed = !out && !r.answered_at && !["ringing", "active"].includes(r.state);
    const dur = r.answered_at && r.ended_at ? Math.max(0, Math.round((r.ended_at.getTime() - r.answered_at.getTime()) / 1000)) : null;
    return {
      id: r.id, direction: out ? "out" : "in", other, otherName, otherNumber: out ? r.to_number : r.from_number,
      state: r.state, missed, reason: r.end_reason, at: r.created_at.toISOString(), durationS: dur, meeting: r.meeting, hasVoicemail: r.has_vm,
    };
  });
  return opts.missedOnly ? items.filter((i) => i.missed) : items;
}

/** Removes a call from this person's history. Kept (still found by eDiscovery) while they are on hold. */
export async function hideCall(email: string, callId: string): Promise<void> {
  const me = email.toLowerCase();
  const [c] = await q<{ id: string }>(
    `SELECT c.id FROM calls c WHERE c.id = $1 AND (c.from_email = $2 OR c.to_email = $2 OR EXISTS (SELECT 1 FROM parties p WHERE p.call_id = c.id AND p.email = $2))`,
    [callId, me],
  );
  if (!c) throw new UserError("Not found", 404);
  await q("INSERT INTO hidden_calls (email, call_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [me, callId]);
}

export type Voicemail = {
  id: string; callId: string | null; from: string; fromName: string; fromNumber: string | null; durationMs: number;
  transcript: string | null; transcriptError: string | null; heard: boolean; at: string;
};

export async function voicemailsFor(email: string): Promise<Voicemail[]> {
  const rows = await q<{
    id: string; call_id: string | null; from_email: string | null; from_number: string | null; from_name: string; duration_ms: number;
    transcript: string | null; transcript_error: string | null; heard_at: Date | null; created_at: Date;
  }>(
    `SELECT id, call_id, from_email, from_number, from_name, duration_ms, transcript, transcript_error, heard_at, created_at
     FROM voicemails WHERE owner = $1 AND held_deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`,
    [email.toLowerCase()],
  );
  return rows.map((r) => ({
    id: r.id, callId: r.call_id, from: r.from_email ?? r.from_number ?? "", fromName: r.from_name || r.from_email || formatNumber(r.from_number) || "Unknown caller",
    fromNumber: r.from_number, durationMs: r.duration_ms, transcript: r.transcript, transcriptError: r.transcript_error,
    heard: Boolean(r.heard_at), at: r.created_at.toISOString(),
  }));
}

export async function voicemailAudio(email: string, id: string): Promise<Buffer> {
  const [r] = await q<{ audio: Buffer }>("SELECT audio FROM voicemails WHERE id = $1 AND owner = $2 AND held_deleted_at IS NULL", [id, email.toLowerCase()]);
  if (!r) throw new UserError("Not found", 404);
  return r.audio;
}

export async function markHeard(email: string, id: string, heard: boolean): Promise<void> {
  const rows = await q("UPDATE voicemails SET heard_at = CASE WHEN $3 THEN COALESCE(heard_at, now()) END WHERE id = $1 AND owner = $2 RETURNING id", [id, email.toLowerCase(), heard]);
  if (!rows.length) throw new UserError("Not found", 404);
}

/** Deletes a voicemail; while its owner is on legal hold it is kept, hidden from them. */
export async function deleteVoicemail(email: string, id: string): Promise<void> {
  const me = email.toLowerCase();
  const onHold = await holdChecker()(me);
  const rows = onHold
    ? await q("UPDATE voicemails SET held_deleted_at = now() WHERE id = $1 AND owner = $2 AND held_deleted_at IS NULL RETURNING id", [id, me])
    : await q("DELETE FROM voicemails WHERE id = $1 AND owner = $2 AND held_deleted_at IS NULL RETURNING id", [id, me]);
  if (!rows.length) throw new UserError("Not found", 404);
}

export async function unheardCount(email: string): Promise<number> {
  const [r] = await q<{ n: string }>("SELECT count(*) AS n FROM voicemails WHERE owner = $1 AND heard_at IS NULL AND held_deleted_at IS NULL", [email.toLowerCase()]);
  return Number(r.n);
}
