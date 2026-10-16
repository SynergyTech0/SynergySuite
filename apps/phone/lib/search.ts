import { type SearchResult, type SearchResults, clipText, queryToSql, readSearchQuery, snippet } from "@synergy/search";
import { displayNameFromEmail } from "@synergy/identity";
import type { Me } from "./api";
import { APP } from "./compliance";
import { q } from "./db";
import { formatNumber } from "./numbers";

/** What suite search can ask Phone for. */
export const KINDS = ["call", "voicemail"];

/**
 * Suite search for one person: their own voicemail (by caller and transcript) and the calls in
 * their history (by the other side's name, email or number).
 */
export async function searchFor(me: Me, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  const want = (k: string) => !s.kinds.length || s.kinds.includes(k);
  const email = me.email.toLowerCase();
  const results: SearchResult[] = [];
  if (want("voicemail")) {
    const params: unknown[] = [email, s.limit];
    const words = queryToSql(s.parsed, ["v.from_name", "COALESCE(v.from_email, '')", "COALESCE(v.from_number, '')", "COALESCE(v.transcript, '')"], params.length + 1);
    params.push(...words.params);
    const rows = await q<{ id: string; from_name: string; from_email: string | null; from_number: string | null; transcript: string | null; duration_ms: number; created_at: Date }>(
      `SELECT v.id, v.from_name, v.from_email, v.from_number, v.transcript, v.duration_ms, v.created_at FROM voicemails v
       WHERE v.owner = $1 AND v.held_deleted_at IS NULL AND ${words.sql} ORDER BY v.created_at DESC LIMIT $2`,
      params,
    );
    for (const r of rows) {
      const from = r.from_name || r.from_email || formatNumber(r.from_number) || "Unknown caller";
      results.push({
        id: `vm:${r.id}`, kind: "voicemail", title: `Voicemail from ${from}`,
        snippet: r.transcript ? snippet(r.transcript, s.parsed) : `${Math.round(r.duration_ms / 1000)} s message`,
        date: r.created_at.toISOString(), url: `/?tab=voicemail&vm=${r.id}`, person: r.from_email ?? r.from_number ?? undefined,
        ...(s.text ? { text: clipText(`Voicemail from ${from}\n${r.transcript ?? ""}`) } : {}),
      });
    }
  }
  if (want("call")) {
    const params: unknown[] = [email, s.limit];
    const cols = ["c.from_name", "COALESCE(c.from_email, '')", "COALESCE(c.from_number, '')", "COALESCE(c.to_email, '')", "COALESCE(c.to_number, '')",
      "COALESCE((SELECT name FROM people WHERE email = c.to_email), '')"];
    const words = queryToSql(s.parsed, cols, params.length + 1);
    params.push(...words.params);
    const rows = await q<{ id: string; from_email: string | null; from_name: string; from_number: string | null; to_email: string | null; to_number: string | null; to_name: string | null; state: string; created_at: Date }>(
      `SELECT c.id, c.from_email, c.from_name, c.from_number, c.to_email, c.to_number, c.state, c.created_at,
         (SELECT name FROM people WHERE email = c.to_email) AS to_name
       FROM calls c
       WHERE (c.from_email = $1 OR c.to_email = $1 OR EXISTS (SELECT 1 FROM parties p WHERE p.call_id = c.id AND p.email = $1))
         AND c.held_deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM hidden_calls h WHERE h.call_id = c.id AND h.email = $1)
         AND ${words.sql}
       ORDER BY c.created_at DESC LIMIT $2`,
      params,
    );
    for (const r of rows) {
      const out = r.from_email === email;
      const other = out
        ? r.to_name || (r.to_email ? displayNameFromEmail(r.to_email) : formatNumber(r.to_number))
        : r.from_name || (r.from_email ? displayNameFromEmail(r.from_email) : formatNumber(r.from_number)) || "Unknown caller";
      const t = `${out ? "Call to" : "Call from"} ${other}`;
      results.push({
        id: `call:${r.id}`, kind: "call", title: t, snippet: r.state === "ended" ? "Answered" : r.state,
        date: r.created_at.toISOString(), url: `/?tab=calls&call=${r.id}`,
        person: (out ? r.to_email ?? r.to_number : r.from_email ?? r.from_number) ?? undefined,
        ...(s.text ? { text: clipText(t) } : {}),
      });
    }
  }
  results.sort((a, b) => b.date.localeCompare(a.date));
  return { app: APP, results: results.slice(0, s.limit) };
}
