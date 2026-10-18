import { q } from "./db";
import { UserError, text } from "./util";

export const STATUSES = ["investigating", "identified", "monitoring", "resolved"] as const;
export type IncidentStatus = (typeof STATUSES)[number];

export type Incident = {
  id: string;
  title: string;
  body: string;
  status: IncidentStatus;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
  created_by: string;
};
export type IncidentUpdate = { id: string; incident_id: string; status: IncidentStatus; body: string; author: string; created_at: Date };
export type IncidentWithUpdates = Incident & { updates: IncidentUpdate[] };

function status(v: unknown): IncidentStatus {
  const s = String(v ?? "");
  if (!(STATUSES as readonly string[]).includes(s)) throw new UserError("Pick a status: investigating, identified, monitoring or resolved");
  return s as IncidentStatus;
}

function incidentId(v: unknown): string {
  const s = String(v ?? "");
  if (!/^\d{1,18}$/.test(s)) throw new UserError("Not found", 404);
  return s;
}

const COLS = "id::text, title, body, status, created_at, updated_at, resolved_at, created_by";

async function withUpdates(rows: Incident[]): Promise<IncidentWithUpdates[]> {
  if (!rows.length) return [];
  const ups = await q<IncidentUpdate>(
    `SELECT id::text, incident_id::text, status, body, author, created_at FROM incident_updates
     WHERE incident_id = ANY($1::bigint[]) ORDER BY created_at DESC, id DESC`,
    [rows.map((r) => r.id)],
  );
  return rows.map((r) => ({ ...r, updates: ups.filter((u) => u.incident_id === r.id) }));
}

/** Open incidents first, then the most recent. */
export async function listIncidents(limit = 50): Promise<IncidentWithUpdates[]> {
  const rows = await q<Incident>(`SELECT ${COLS} FROM incidents ORDER BY (status = 'resolved'), created_at DESC LIMIT $1`, [limit]);
  return withUpdates(rows);
}

export async function createIncident(b: { title?: unknown; body?: unknown; status?: unknown }, author: string): Promise<Incident> {
  const title = text(b.title, 200);
  if (!title) throw new UserError("Give the incident a title");
  const body = text(b.body, 5000);
  const st = b.status === undefined || b.status === "" ? "investigating" : status(b.status);
  const [i] = await q<Incident>(
    `INSERT INTO incidents (title, body, status, created_by, resolved_at) VALUES ($1, $2, $3, $4, CASE WHEN $3 = 'resolved' THEN now() END) RETURNING ${COLS}`,
    [title, body, st, author],
  );
  await q(`INSERT INTO incident_updates (incident_id, status, body, author) VALUES ($1, $2, $3, $4)`, [i.id, st, body, author]);
  return i;
}

/** Posts an update: a new status and what changed. Resolving stamps the time it was resolved. */
export async function addUpdate(id: string, b: { status?: unknown; body?: unknown }, author: string): Promise<Incident> {
  const st = status(b.status);
  const body = text(b.body, 5000);
  const [i] = await q<Incident>(
    `UPDATE incidents SET status = $2, updated_at = now(),
       resolved_at = CASE WHEN $2 = 'resolved' THEN COALESCE(resolved_at, now()) ELSE NULL END
     WHERE id = $1 RETURNING ${COLS}`,
    [incidentId(id), st],
  );
  if (!i) throw new UserError("Not found", 404);
  await q(`INSERT INTO incident_updates (incident_id, status, body, author) VALUES ($1, $2, $3, $4)`, [i.id, st, body, author]);
  return i;
}

export async function editIncident(id: string, b: { title?: unknown; body?: unknown }): Promise<Incident> {
  const [cur] = await q<Incident>(`SELECT ${COLS} FROM incidents WHERE id = $1`, [incidentId(id)]);
  if (!cur) throw new UserError("Not found", 404);
  const title = b.title === undefined ? cur.title : text(b.title, 200);
  if (!title) throw new UserError("Give the incident a title");
  const [i] = await q<Incident>(`UPDATE incidents SET title = $2, body = $3, updated_at = now() WHERE id = $1 RETURNING ${COLS}`, [
    cur.id,
    title,
    b.body === undefined ? cur.body : text(b.body, 5000),
  ]);
  return i;
}

export async function deleteIncident(id: string): Promise<void> {
  await q(`DELETE FROM incidents WHERE id = $1`, [incidentId(id)]);
}
