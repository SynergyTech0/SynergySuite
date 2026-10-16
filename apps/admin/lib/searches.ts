import { record } from "./audit";
import { q, tx } from "./db";
import { get as getMatter } from "./matters";
import { cleanSearch, type SearchInput } from "./search";
import type { Me, SavedSearch } from "./types";
import { UserError, required, uuid } from "./util";

/** Searches saved to a matter, so they can be run again and exported. */

type Row = {
  id: string; matter_id: string; name: string; query: string; custodians: string[]; apps: string[];
  from_date: string | null; to_date: string | null; counts: Record<string, number>; created_by: string; created_at: Date;
};

const COLS = `id, matter_id, name, query, custodians, apps, to_char(from_date, 'YYYY-MM-DD') AS from_date,
  to_char(to_date, 'YYYY-MM-DD') AS to_date, counts, created_by, created_at`;

function toSearch(r: Row): SavedSearch {
  return {
    id: r.id, matterId: r.matter_id, name: r.name, query: r.query, custodians: r.custodians, apps: r.apps,
    from: r.from_date, to: r.to_date, counts: r.counts, createdBy: r.created_by, createdAt: r.created_at.toISOString(),
  };
}

export function inputOf(s: SavedSearch): SearchInput {
  return { query: s.query, custodians: s.custodians, apps: s.apps, from: s.from, to: s.to };
}

export async function listForMatter(matterId: string): Promise<SavedSearch[]> {
  return (await q<Row>(`SELECT ${COLS} FROM searches WHERE matter_id = $1 ORDER BY created_at DESC`, [matterId])).map(toSearch);
}

export async function getSearch(me: Me, id: string): Promise<SavedSearch> {
  const [r] = await q<Row>(`SELECT ${COLS} FROM searches WHERE id = $1`, [uuid(id, "That search")]);
  if (!r) throw new UserError("That search was not found", 404);
  await getMatter(me, r.matter_id); // 404 unless this person may see the matter
  return toSearch(r);
}

export async function save(me: Me, matterId: string, v: Record<string, unknown>): Promise<SavedSearch> {
  const name = required(v.name, "A name", 200);
  const s = cleanSearch(v);
  const counts: Record<string, number> = {};
  if (v.counts && typeof v.counts === "object") {
    for (const [k, n] of Object.entries(v.counts as Record<string, unknown>)) if (typeof n === "number" && Number.isFinite(n)) counts[k.slice(0, 40)] = n;
  }
  return tx(async (tq) => {
    const m = await getMatter(me, matterId, tq);
    const [r] = await tq<Row>(
      `INSERT INTO searches (matter_id, name, query, custodians, apps, from_date, to_date, counts, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${COLS}`,
      [m.id, name, s.query, JSON.stringify(s.custodians), JSON.stringify(s.apps), s.from, s.to, JSON.stringify(counts), me.email],
    );
    await record(me.email, "search.save", r.id, { matter: m.id, matterName: m.name, name, ...s, apps: s.apps.length ? s.apps : "all" }, tq);
    return toSearch(r);
  });
}
