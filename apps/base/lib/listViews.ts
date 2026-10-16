/**
 * Saved Lists view settings, one row per table (lib/listViewSettings.ts says what they hold).
 * Anyone who can open the table reads them; editors change them.
 */
import { canEdit, getTable } from "./catalog";
import { db } from "./db";
import { forbidden } from "./http";
import { cleanListViews, type ListViewSettings } from "./listViewSettings";

export async function getListViews(tableId: string, email: string): Promise<ListViewSettings> {
  await getTable(tableId, email);
  const { rows } = await db().q(`SELECT settings FROM base_list_views WHERE table_id = $1`, [tableId]);
  return cleanListViews(rows[0]?.settings);
}

export async function saveListViews(tableId: string, email: string, raw: unknown): Promise<ListViewSettings> {
  const t = await getTable(tableId, email);
  if (!canEdit(t.role)) throw forbidden();
  const settings = cleanListViews(raw);
  await db().q(
    `INSERT INTO base_list_views (table_id, settings) VALUES ($1, $2)
     ON CONFLICT (table_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()`,
    [tableId, settings],
  );
  return settings;
}
