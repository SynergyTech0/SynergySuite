// Suite-wide search (packages/search) for the signed-in person. Ops has no roles: everyone the
// suite signs in sees every item, bill, work order, asset and maintenance order, exactly as the
// app's own lists show them, so results are not filtered per person.
import { clipText, queryToSql, readSearchQuery, snippet, type SearchResult, type SearchResults } from "@synergy/search";
import { q } from "./db";
import { APP } from "./compliance";
import type { Me } from "./api";

export const KINDS = ["item", "bom", "work_order", "asset", "maintenance"] as const;

type Parsed = ReturnType<typeof readSearchQuery>;
type Row = Record<string, string | Date | null>;

const iso = (d: unknown) => new Date(d as string).toISOString();

async function items(s: Parsed): Promise<SearchResult[]> {
  const w = queryToSql(s.parsed, ["i.sku", "i.name", "i.description"], 2);
  const rows = await q<Row>(`SELECT i.id, i.sku, i.name, i.description, i.updated_at FROM items i WHERE i.active AND ${w.sql} ORDER BY i.updated_at DESC LIMIT $1`, [s.limit, ...w.params]);
  return rows.map((r) => ({
    id: `item:${r.id}`, kind: "item", title: `${r.sku} ${r.name}`, snippet: snippet(String(r.description || r.name), s.parsed),
    date: iso(r.updated_at), url: `/?item=${r.id}`, ...(s.text ? { text: clipText(`${r.sku} ${r.name}\n${r.description}`) } : {}),
  }));
}

async function boms(s: Parsed): Promise<SearchResult[]> {
  const w = queryToSql(s.parsed, ["i.sku", "i.name", "b.notes"], 2);
  const rows = await q<Row>(
    `SELECT b.id, b.version, b.status, b.notes, b.created_by, b.updated_at, i.sku, i.name FROM boms b JOIN items i ON i.id = b.item_id
     WHERE ${w.sql} ORDER BY b.updated_at DESC LIMIT $1`,
    [s.limit, ...w.params],
  );
  return rows.map((r) => ({
    id: `bom:${r.id}`, kind: "bom", title: `Bill of materials: ${r.sku} v${r.version}${r.status === "active" ? "" : ` (${r.status})`}`,
    snippet: snippet(String(r.notes || r.name), s.parsed), date: iso(r.updated_at), url: `/?bom=${r.id}`,
    ...(r.created_by ? { person: String(r.created_by) } : {}), ...(s.text ? { text: clipText(`${r.sku} ${r.name}\n${r.notes}`) } : {}),
  }));
}

async function workOrders(s: Parsed): Promise<SearchResult[]> {
  const w = queryToSql(s.parsed, ["w.number", "i.sku", "i.name", "w.notes"], 2);
  const rows = await q<Row>(
    `SELECT w.id, w.number, w.status, w.notes, w.assignee, w.created_by, w.updated_at, i.sku, i.name FROM work_orders w JOIN items i ON i.id = w.item_id
     WHERE ${w.sql} ORDER BY w.updated_at DESC LIMIT $1`,
    [s.limit, ...w.params],
  );
  return rows.map((r) => ({
    id: `work_order:${r.id}`, kind: "work_order", title: `${r.number} ${r.sku} ${r.name}`, snippet: snippet(String(r.notes || `${r.status}`), s.parsed),
    date: iso(r.updated_at), url: `/?wo=${r.id}`, person: String(r.assignee || r.created_by || ""),
    ...(s.text ? { text: clipText(`${r.number} ${r.sku} ${r.name}\n${r.notes}`) } : {}),
  }));
}

async function assets(s: Parsed): Promise<SearchResult[]> {
  const w = queryToSql(s.parsed, ["a.tag", "a.name", "a.serial", "a.make", "a.model", "a.location", "a.category", "a.notes"], 2);
  const rows = await q<Row>(
    `SELECT a.id, a.tag, a.name, a.location, a.serial, a.notes, a.assignee, a.updated_at FROM assets a WHERE ${w.sql} ORDER BY a.updated_at DESC LIMIT $1`,
    [s.limit, ...w.params],
  );
  return rows.map((r) => ({
    id: `asset:${r.id}`, kind: "asset", title: `${r.tag} ${r.name}`, snippet: snippet(String(r.notes || [r.location, r.serial].filter(Boolean).join(" · ")), s.parsed),
    date: iso(r.updated_at), url: `/?asset=${r.id}`, ...(r.assignee ? { person: String(r.assignee) } : {}),
    ...(s.text ? { text: clipText(`${r.tag} ${r.name}\n${r.notes}`) } : {}),
  }));
}

async function maintenance(s: Parsed): Promise<SearchResult[]> {
  const w = queryToSql(s.parsed, ["o.number", "o.title", "o.description", "o.resolution", "a.tag", "a.name"], 2);
  const rows = await q<Row>(
    `SELECT o.id, o.number, o.title, o.description, o.resolution, o.requested_by, o.updated_at, a.tag FROM maint_orders o JOIN assets a ON a.id = o.asset_id
     WHERE ${w.sql} ORDER BY o.updated_at DESC LIMIT $1`,
    [s.limit, ...w.params],
  );
  return rows.map((r) => ({
    id: `maintenance:${r.id}`, kind: "maintenance", title: `${r.number} ${r.title} (${r.tag})`,
    snippet: snippet(String(r.description || r.resolution || r.title), s.parsed), date: iso(r.updated_at), url: `/?mo=${r.id}`,
    ...(r.requested_by && r.requested_by !== "scheduler" ? { person: String(r.requested_by) } : {}),
    ...(s.text ? { text: clipText(`${r.title}\n${r.description}\n${r.resolution}`) } : {}),
  }));
}

export async function searchFor(_me: Me, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  const want = (k: string) => !s.kinds.length || s.kinds.includes(k);
  const parts = await Promise.all([
    want("item") ? items(s) : [],
    want("bom") ? boms(s) : [],
    want("work_order") ? workOrders(s) : [],
    want("asset") ? assets(s) : [],
    want("maintenance") ? maintenance(s) : [],
  ]);
  const results = parts.flat().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, s.limit);
  return { app: APP, results };
}
