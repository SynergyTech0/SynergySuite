import { type ExportItem, MAX_ATTACHMENT_BYTES, type SearchHit, type SearchResponse, queryToSql } from "@synergy/compliance";
import { q } from "./db";
import { APP, type Search, holdChecker, nextCursor, policy, snippet } from "./compliance";
import { formatNumber } from "./numbers";

/**
 * Phone's content for the Admin center: call records (who called whom, when, how long, who
 * answered) and voicemail (the recording and its transcript). Ids are "call:<id>" and "vm:<id>".
 */
export const KINDS = ["call", "voicemail"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One searchable row per call and per voicemail, with the same columns. */
const ITEMS = `
  SELECT 'call' AS kind, c.id, c.created_at AS at,
    COALESCE(c.from_email, c.to_email, (SELECT p.email FROM parties p WHERE p.call_id = c.id AND p.email IS NOT NULL ORDER BY p.created_at LIMIT 1), '') AS owner,
    ARRAY(SELECT DISTINCT p.email FROM parties p WHERE p.call_id = c.id AND p.email IS NOT NULL ORDER BY p.email) AS people,
    c.direction, c.from_email, c.from_number, c.from_name, c.to_email, c.to_number, c.state, c.end_reason,
    c.answered_at, c.ended_at, c.answered_by, NULL::text AS transcript, NULL::int AS duration_ms, 0 AS bytes,
    c.held_deleted_at,
    concat_ws(' ', c.from_name, c.from_email, c.from_number, c.to_email, c.to_number, c.end_reason,
      (SELECT string_agg(concat_ws(' ', p.email, p.number), ' ') FROM parties p WHERE p.call_id = c.id)) AS body
  FROM calls c
  UNION ALL
  SELECT 'voicemail', v.id, v.created_at, v.owner,
    ARRAY_REMOVE(ARRAY[v.from_email], NULL),
    NULL, v.from_email, v.from_number, v.from_name, v.owner, NULL, NULL, NULL,
    NULL, NULL, NULL, v.transcript, v.duration_ms, octet_length(v.audio), v.held_deleted_at,
    concat_ws(' ', v.from_name, v.from_email, v.from_number, v.owner, v.transcript)
  FROM voicemails v`;

type Row = {
  kind: "call" | "voicemail"; id: string; at: Date; owner: string; people: string[]; direction: string | null;
  from_email: string | null; from_number: string | null; from_name: string; to_email: string | null; to_number: string | null;
  state: string | null; end_reason: string | null; answered_at: Date | null; ended_at: Date | null; answered_by: string | null;
  transcript: string | null; duration_ms: number | null; bytes: number; held_deleted_at: Date | null; total?: string;
};

const who = (email: string | null, number: string | null, name = "") => name || email || formatNumber(number) || "unknown";

function title(r: Row): string {
  if (r.kind === "voicemail") return `Voicemail from ${who(r.from_email, r.from_number, r.from_name)}`;
  const from = who(r.from_email, r.from_number, r.from_name);
  const to = r.to_email || formatNumber(r.to_number) || "unknown";
  return `Call from ${from} to ${to}`;
}

function summary(r: Row): string {
  if (r.kind === "voicemail") return r.transcript || `${Math.round((r.duration_ms ?? 0) / 1000)} s recording`;
  const secs = r.answered_at && r.ended_at ? Math.round((r.ended_at.getTime() - r.answered_at.getTime()) / 1000) : null;
  return [
    r.direction === "inbound" ? "From outside" : r.direction === "outbound" ? "To an outside number" : "Between colleagues",
    r.state,
    secs !== null ? `${secs} s` : null,
    r.answered_by ? `answered by ${r.answered_by}` : null,
    r.end_reason,
  ].filter(Boolean).join(" · ");
}

function hit(r: Row, s: Pick<Search, "query">): SearchHit {
  const people = r.people.filter((p) => p && p !== r.owner);
  return {
    id: `${r.kind === "call" ? "call" : "vm"}:${r.id}`,
    kind: r.kind,
    title: title(r),
    owner: r.owner,
    ...(people.length ? { participants: people } : {}),
    date: r.at.toISOString(),
    snippet: r.kind === "voicemail" && r.transcript ? snippet(r.transcript, s.query) : summary(r),
    ...(r.kind === "voicemail" ? { size: r.bytes } : {}),
    ...(r.held_deleted_at ? { deleted: true } : {}),
  };
}

export async function search(s: Search): Promise<SearchResponse> {
  const kinds = s.kinds ?? KINDS;
  if (!kinds.length) return { app: APP, hits: [], total: 0 };
  const params: unknown[] = [s.custodians, s.from, s.until, s.limit, s.offset, kinds];
  const words = queryToSql(s.query, ["i.body"], params.length + 1);
  params.push(...words.params);
  const rows = await q<Row>(
    `SELECT i.*, COUNT(*) OVER () AS total FROM (${ITEMS}) i
     WHERE i.kind = ANY($6) AND ${words.sql}
       AND (cardinality($1::text[]) = 0 OR i.owner = ANY($1) OR i.people && $1::text[])
       AND ($2::timestamptz IS NULL OR i.at >= $2)
       AND ($3::timestamptz IS NULL OR i.at < $3)
     ORDER BY i.at DESC, i.id
     LIMIT $4 OFFSET $5`,
    params,
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { app: APP, hits: rows.map((r) => hit(r, s)), total, nextCursor: nextCursor(s, s.offset + rows.length < total) };
}

export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const calls = ids.filter((i) => i.startsWith("call:")).map((i) => i.slice(5)).filter((i) => UUID.test(i));
  const vms = ids.filter((i) => i.startsWith("vm:")).map((i) => i.slice(3)).filter((i) => UUID.test(i));
  if (!calls.length && !vms.length) return { items: [] };
  const rows = await q<Row>(
    `SELECT i.* FROM (${ITEMS}) i WHERE (i.kind = 'call' AND i.id = ANY($1::uuid[])) OR (i.kind = 'voicemail' AND i.id = ANY($2::uuid[]))`,
    [calls, vms],
  );
  const parties = calls.length
    ? await q<{ call_id: string; email: string | null; number: string | null; role: string; state: string; invited_by: string | null; joined_at: Date | null; left_at: Date | null; created_at: Date }>(
        "SELECT call_id, email, number, role, state, invited_by, joined_at, left_at, created_at FROM parties WHERE call_id = ANY($1::uuid[]) ORDER BY created_at",
        [calls],
      )
    : [];
  const audio = vms.length
    ? new Map((await q<{ id: string; audio: Buffer }>("SELECT id, audio FROM voicemails WHERE id = ANY($1::uuid[])", [vms])).map((a) => [a.id, a.audio]))
    : new Map<string, Buffer>();
  const empty = { query: { groups: [], none: [] } };
  const items = rows.map((r): ExportItem => {
    const base = { ...hit(r, empty), app: APP };
    if (r.kind === "voicemail") {
      const wav = audio.get(r.id);
      const att = wav
        ? wav.length > MAX_ATTACHMENT_BYTES
          ? { name: "voicemail.wav", type: "audio/wav", size: wav.length, skipped: "Larger than the export limit" }
          : { name: "voicemail.wav", type: "audio/wav", size: wav.length, base64: wav.toString("base64") }
        : null;
      return {
        ...base,
        metadata: { from: r.from_email ?? r.from_number, fromName: r.from_name, durationMs: r.duration_ms, heldDeletedAt: r.held_deleted_at?.toISOString() ?? null },
        text: r.transcript ?? "",
        ...(att ? { attachments: [att] } : {}),
      };
    }
    return {
      ...base,
      metadata: {
        direction: r.direction, from: r.from_email ?? r.from_number, fromName: r.from_name, fromNumber: r.from_number,
        to: r.to_email ?? r.to_number, toNumber: r.to_number, state: r.state, endReason: r.end_reason,
        answeredBy: r.answered_by, answeredAt: r.answered_at?.toISOString() ?? null, endedAt: r.ended_at?.toISOString() ?? null,
        parties: parties.filter((p) => p.call_id === r.id).map((p) => ({
          email: p.email, number: p.number, role: p.role, state: p.state, invitedBy: p.invited_by,
          rangAt: p.created_at.toISOString(), joinedAt: p.joined_at?.toISOString() ?? null, leftAt: p.left_at?.toISOString() ?? null,
        })),
      },
      text: `${title(r)}\n${summary(r)}`,
    };
  });
  const order = ids.map((i) => i.replace(/^(call|vm):/, ""));
  items.sort((x, y) => order.indexOf(x.id.replace(/^(call|vm):/, "")) - order.indexOf(y.id.replace(/^(call|vm):/, "")));
  return { items };
}

/**
 * Retention: voicemail and call records older than the Admin center's rules allow are deleted,
 * except where anyone on them is on hold. Call records go only once their voicemail has.
 */
export async function sweepRetention(): Promise<number> {
  const onHold = holdChecker();
  let n = 0;
  const vmDays = await policy().retentionDays("voicemail");
  if (vmDays !== null) {
    const old = await q<{ id: string; owner: string }>("SELECT id, owner FROM voicemails WHERE created_at < now() - make_interval(days => $1) LIMIT 2000", [vmDays]);
    for (const v of old) {
      if (await onHold(v.owner)) continue;
      await q("DELETE FROM voicemails WHERE id = $1", [v.id]);
      n++;
    }
  }
  const callDays = await policy().retentionDays("call");
  if (callDays !== null) {
    const old = await q<{ id: string; people: string[] }>(
      `SELECT c.id, ARRAY_REMOVE(ARRAY[c.from_email, c.to_email] || ARRAY(SELECT p.email FROM parties p WHERE p.call_id = c.id), NULL) AS people
       FROM calls c WHERE c.created_at < now() - make_interval(days => $1) AND c.state IN ('ended', 'missed', 'declined', 'failed')
         AND NOT EXISTS (SELECT 1 FROM voicemails v WHERE v.call_id = c.id) LIMIT 2000`,
      [callDays],
    );
    for (const c of old) {
      let held = false;
      for (const p of c.people) if (await onHold(p)) held = true;
      if (held) continue;
      await q("DELETE FROM calls WHERE id = $1", [c.id]);
      n++;
    }
  }
  return n;
}
