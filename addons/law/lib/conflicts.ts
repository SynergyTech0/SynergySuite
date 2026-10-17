import type { Me } from "./api";
import { q } from "./db";
import { isAdmin } from "./law";
import { bestMatch, normalize } from "./parties";
import { UserError, text, uuidish } from "./util";

/**
 * Conflict checks run a list of names (a new client, the other side, their lawyers) against every
 * client and every party on every matter in the firm, whoever's matter it is, because a conflict
 * hides exactly where the person checking can't see. Hits show only the matter's number, name,
 * responsible lawyer and the role the name plays there. Every check is kept with its decision.
 */

export type Hit = {
  query: string;
  name: string;
  score: number;
  source: "client" | "party";
  role: string;
  clientId: string;
  clientName: string;
  matterId: string | null;
  matterNumber: string | null;
  matterTitle: string | null;
  matterStatus: string | null;
  responsible: string | null;
};

type Candidate = {
  source: "client" | "party"; name: string; normalized: string; aliases: string[]; role: string; client_id: string; client_name: string;
  matter_id: string | null; number: string | null; title: string | null; status: string | null; responsible: string | null;
};

export const DEFAULT_THRESHOLD = 75;

/** Every name in the firm worth checking against. */
async function candidates(): Promise<Candidate[]> {
  return q<Candidate>(
    `SELECT 'client' AS source, c.name, c.normalized, c.aliases, 'client' AS role, c.id AS client_id, c.name AS client_name,
       NULL::uuid AS matter_id, NULL AS number, NULL AS title, NULL AS status, NULL AS responsible
     FROM clients c WHERE c.held_deleted_at IS NULL
     UNION ALL
     SELECT 'party', p.name, p.normalized, p.aliases, p.role, c.id, c.name, m.id, m.number, m.title, m.status, m.responsible
     FROM matter_parties p JOIN matters m ON m.id = p.matter_id JOIN clients c ON c.id = m.client_id
     WHERE m.held_deleted_at IS NULL
     LIMIT 200000`,
  );
}

/** Names matching any of `names` at `threshold` or above, best first. Pure, for tests. */
export function matchNames(names: string[], pool: Candidate[], threshold = DEFAULT_THRESHOLD): Hit[] {
  const hits: Hit[] = [];
  for (const query of names) {
    const n = normalize(query);
    if (!n.normalized) continue;
    for (const c of pool) {
      const aliases = (c.aliases ?? []).map((a) => normalize(a).normalized);
      const score = bestMatch(n, { normalized: c.normalized, aliases });
      if (score < threshold) continue;
      hits.push({
        query, name: c.name, score, source: c.source, role: c.role, clientId: c.client_id, clientName: c.client_name,
        matterId: c.matter_id, matterNumber: c.number, matterTitle: c.title, matterStatus: c.status, responsible: c.responsible,
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 500);
}

/** The matters each client hit is on, so a reviewer sees where that client is represented. */
async function withClientMatters(hits: Hit[]) {
  const ids = [...new Set(hits.filter((h) => h.source === "client").map((h) => h.clientId))];
  if (!ids.length) return {};
  const rows = await q<{ client_id: string; id: string; number: string; title: string; status: string; responsible: string }>(
    `SELECT client_id, id, number, title, status, responsible FROM matters WHERE client_id = ANY($1::uuid[]) AND held_deleted_at IS NULL ORDER BY opened_on DESC`,
    [ids],
  );
  const out: Record<string, typeof rows> = {};
  for (const r of rows) (out[r.client_id] ??= []).push(r);
  return out;
}

export async function runCheck(me: Me, b: Record<string, unknown>) {
  const raw = Array.isArray(b.names) ? b.names : String(b.names ?? "").split(/\n+/);
  const names = [...new Set(raw.map((n) => text(n, 200)).filter(Boolean))].slice(0, 50);
  if (!names.length) throw new UserError("Enter at least one name to check");
  const threshold = b.threshold === undefined ? DEFAULT_THRESHOLD : Math.min(100, Math.max(50, Math.round(Number(b.threshold) || DEFAULT_THRESHOLD)));
  const matterId = b.matterId && uuidish(b.matterId) ? String(b.matterId) : null;
  const hits = matchNames(names, await candidates(), threshold);
  const clientMatters = await withClientMatters(hits);
  const results = { threshold, hits, clientMatters };
  const [row] = await q<{ id: string; checked_at: Date }>(
    `INSERT INTO conflict_checks (names, matter_id, results, hits, decision, checked_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, checked_at`,
    [names, matterId, JSON.stringify(results), hits.length, hits.length ? "pending" : "cleared", me.email],
  );
  return { id: row.id, names, decision: hits.length ? "pending" : "cleared", checked_at: row.checked_at, ...results };
}

export async function getCheck(me: Me, id: string) {
  if (!uuidish(id)) throw new UserError("Not found", 404);
  const [c] = await q<Record<string, unknown> & { checked_by: string }>(
    `SELECT k.id, k.names, k.matter_id, m.number AS matter_number, k.results, k.hits, k.decision, k.note, k.checked_by, k.checked_at, k.decided_by, k.decided_at
     FROM conflict_checks k LEFT JOIN matters m ON m.id = k.matter_id WHERE k.id = $1`,
    [id],
  );
  if (!c) throw new UserError("Not found", 404);
  return c;
}

export async function listChecks(me: Me, limit = 100) {
  return q(
    `SELECT k.id, k.names, k.matter_id, m.number AS matter_number, k.hits, k.decision, k.note, k.checked_by, k.checked_at, k.decided_by, k.decided_at
     FROM conflict_checks k LEFT JOIN matters m ON m.id = k.matter_id
     WHERE $1 OR k.checked_by = $2 OR m.responsible = $2 ORDER BY k.checked_at DESC LIMIT $3`,
    [isAdmin(me.email), me.email, limit],
  );
}

/** Clears, waives (with the client's consent noted) or declines a check with hits. */
export async function decideCheck(me: Me, id: string, b: Record<string, unknown>) {
  const c = await getCheck(me, id);
  const decision = String(b.decision);
  if (!["cleared", "waived", "declined"].includes(decision)) throw new UserError("Pick cleared, waived or declined");
  const note = text(b.note, 2000);
  if (decision !== "cleared" && !note) throw new UserError(decision === "waived" ? "Note who consented and how" : "Say why it was declined");
  const [lead] = c.matter_id ? await q<{ responsible: string }>(`SELECT responsible FROM matters WHERE id = $1`, [c.matter_id]) : [];
  if (c.checked_by !== me.email && lead?.responsible !== me.email && !isAdmin(me.email)) {
    throw new UserError("Only the person who ran the check, the matter's lawyer or an administrator can decide it", 403);
  }
  await q(`UPDATE conflict_checks SET decision = $2, note = $3, decided_by = $4, decided_at = now() WHERE id = $1`, [id, decision, note, me.email]);
  return getCheck(me, id);
}
