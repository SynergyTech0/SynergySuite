import type { Metabase } from "./metabase";

export interface DashboardSummary {
  id: number;
  name: string;
  description: string | null;
  collection: string | null;
  updatedAt: string | null;
}

export interface DashboardDetail extends DashboardSummary {
  canWrite: boolean;
}

interface MbDashboard {
  id: number;
  name: string;
  description?: string | null;
  collection?: { name?: string | null } | null;
  collection_id?: number | null;
  updated_at?: string | null;
  archived?: boolean;
  can_write?: boolean;
  enable_embedding?: boolean;
  embedding_params?: Record<string, string> | null;
  parameters?: { slug: string }[];
}

function summary(d: MbDashboard): DashboardSummary {
  return {
    id: d.id,
    name: d.name,
    description: d.description ?? null,
    collection: d.collection?.name ?? null,
    updatedAt: d.updated_at ?? null,
  };
}

/**
 * The dashboards this person can open in Metabase, newest change first. Read from the
 * dashboard list rather than Metabase's search, which indexes new dashboards a little later.
 */
export async function listDashboards(mb: Metabase, email: string, name: string): Promise<DashboardSummary[]> {
  const [dashboards, collections] = await Promise.all([
    mb.asPerson<MbDashboard[]>(email, name, "/api/dashboard?f=all"),
    mb.asPerson<{ id: number | string; name: string }[]>(email, name, "/api/collection").catch(() => []),
  ]);
  const names = new Map(collections.map((c) => [String(c.id), c.name]));
  return dashboards
    .filter((d) => !d.archived)
    .map((d) => ({ ...summary(d), collection: d.collection?.name ?? names.get(String(d.collection_id ?? "root")) ?? null }))
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

/** One dashboard, if this person can open it (Metabase answers 403 or 404 otherwise). */
export async function getDashboard(mb: Metabase, email: string, name: string, id: number): Promise<DashboardDetail | null> {
  try {
    const d = await mb.asPerson<MbDashboard>(email, name, `/api/dashboard/${id}`);
    if (d.archived) return null;
    return { ...summary(d), canWrite: Boolean(d.can_write) };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 403 || status === 404) return null;
    throw err;
  }
}

/**
 * Turns on static embedding for a dashboard, so Insights can show it inside its own page, with
 * every filter the dashboard has left for the viewer to change. Done as the service account
 * (embedding is an admin setting in Metabase), and only after the viewer's own access was checked.
 */
export async function ensureEmbeddable(mb: Metabase, id: number): Promise<void> {
  const d = await mb.asService<MbDashboard>(`/api/dashboard/${id}`);
  const params = Object.fromEntries((d.parameters ?? []).map((p) => [p.slug, "enabled"]));
  const current = d.embedding_params ?? {};
  const same = Object.keys(params).length === Object.keys(current).length && Object.entries(params).every(([k, v]) => current[k] === v);
  if (d.enable_embedding && same) return;
  await mb.asService(`/api/dashboard/${id}`, { method: "PUT", body: { enable_embedding: true, embedding_params: params } });
}
