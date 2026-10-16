/**
 * Data links: a secret address that reads a table or saved query as CSV without signing in, so
 * Sheets (Data > Get data > From web) and other tools can pull it and refresh it later. Anyone
 * with the address can read the data, so only editors make or turn off links, and a link reads
 * as the person who made it: it stops working if they lose access.
 */
import { randomBytes } from "node:crypto";
import { canEdit, getDatabase, getTable, listTables } from "./catalog";
import { db, ready } from "./db";
import { FieldValueError } from "./fields";
import { forbidden, notFound } from "./http";
import { getQuery, listQueries } from "./queries";

export type LinkSource = { kind: "table" | "query"; id: string };
export type DataLink = { token: string; path: string; createdBy: string; createdAt: string };

const linkRow = (r: any): DataLink => ({ token: r.token, path: `/api/feed/${r.token}.csv`, createdBy: r.created_by, createdAt: new Date(r.created_at).toISOString() });

async function check(databaseId: string, email: string, raw: unknown, edit: boolean): Promise<LinkSource> {
  const info = await getDatabase(databaseId, email);
  if (!info) throw notFound();
  if (edit && !canEdit(info.role)) throw forbidden();
  const s = (raw ?? {}) as { kind?: unknown; id?: unknown };
  const kind = s.kind === "query" ? "query" : "table";
  const id = String(s.id ?? "");
  const exists = kind === "table" ? (await listTables(databaseId, email)).some((t) => t.id === id) : (await listQueries(databaseId, email)).some((q) => q.id === id);
  if (!exists) throw new FieldValueError(`Pick the ${kind} to link to`);
  return { kind, id };
}

export async function getLink(databaseId: string, email: string, source: unknown): Promise<DataLink | null> {
  const s = await check(databaseId, email, source, false);
  const { rows } = await db().q(`SELECT * FROM base_links WHERE database_id = $1 AND source_kind = $2 AND source_id = $3`, [databaseId, s.kind, s.id]);
  return rows[0] ? linkRow(rows[0]) : null;
}

/** The source's link, made now if it has none. */
export async function makeLink(databaseId: string, email: string, source: unknown): Promise<DataLink> {
  const s = await check(databaseId, email, source, true);
  const { rows } = await db().q(
    `INSERT INTO base_links (token, database_id, source_kind, source_id, created_by) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (source_kind, source_id) DO UPDATE SET source_kind = EXCLUDED.source_kind RETURNING *`,
    [randomBytes(24).toString("base64url"), databaseId, s.kind, s.id, email],
  );
  return linkRow(rows[0]);
}

/** Turns the link off; anything still using the address gets "not found". */
export async function removeLink(databaseId: string, email: string, source: unknown): Promise<void> {
  const s = await check(databaseId, email, source, true);
  await db().q(`DELETE FROM base_links WHERE database_id = $1 AND source_kind = $2 AND source_id = $3`, [databaseId, s.kind, s.id]);
}

/** What a link reads, checked as the person who made it. */
export async function resolveLink(token: string): Promise<{ kind: "table"; table: Awaited<ReturnType<typeof getTable>> } | { kind: "query"; query: Awaited<ReturnType<typeof getQuery>>; email: string }> {
  await ready();
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw notFound();
  const { rows } = await db().q(`SELECT * FROM base_links WHERE token = $1`, [token]);
  const l = rows[0];
  if (!l) throw notFound();
  if (l.source_kind === "table") return { kind: "table", table: await getTable(l.source_id, l.created_by) };
  const query = await getQuery(l.source_id, l.created_by);
  if (query.databaseId !== l.database_id) throw notFound();
  return { kind: "query", query, email: l.created_by };
}
