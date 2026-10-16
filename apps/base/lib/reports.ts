/**
 * Saved reports: a table or saved query, read through the same read-only query runner as queries
 * (lib/queries.ts), laid out by lib/reportLayout.ts. A table's lookups show their related
 * record's display field, as its datasheet does, rather than the related record's ID.
 */
import { canEdit, getDatabase, listTables, newId, type DatabaseInfo, type Role, type TableInfo } from "./catalog";
import { db, ready } from "./db";
import { cleanName, FieldValueError, type Field } from "./fields";
import { forbidden, HttpError, notFound } from "./http";
import { quoteName } from "./names";
import { listQueries, runQuery } from "./queries";
import { buildReport, cleanReportLayout, type Format, type ReportData, type ReportLayout, type SourceColumn } from "./reportLayout";

export type ReportSource = { kind: "table" | "query"; id: string };

export type ReportInfo = {
  id: string;
  databaseId: string;
  name: string;
  source: ReportSource;
  layout: ReportLayout;
  position: number;
  updatedAt: string;
};

/** Reports read at most this many records. */
export const MAX_REPORT_ROWS = 20_000;

function reportRow(r: any): ReportInfo {
  return {
    id: r.id,
    databaseId: r.database_id,
    name: r.name,
    source: { kind: r.source_kind, id: r.source_id },
    layout: cleanReportLayout(r.layout),
    position: r.position,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

async function member(databaseId: string, email: string): Promise<DatabaseInfo> {
  const info = await getDatabase(databaseId, email);
  if (!info) throw notFound();
  return info;
}

export async function listReports(databaseId: string, email: string): Promise<ReportInfo[]> {
  await member(databaseId, email);
  const { rows } = await db().q(`SELECT * FROM base_reports WHERE database_id = $1 ORDER BY position, lower(name)`, [databaseId]);
  return rows.map(reportRow);
}

async function loadReport(id: string, email: string): Promise<ReportInfo & { role: Role }> {
  await ready();
  const { rows } = await db().q(
    `SELECT r.*, m.role FROM base_reports r JOIN base_members m ON m.database_id = r.database_id AND m.email = $2 WHERE r.id = $1`,
    [id, email],
  );
  if (!rows[0]) throw notFound();
  return { ...reportRow(rows[0]), role: rows[0].role };
}

export async function getReport(id: string, email: string): Promise<ReportInfo> {
  const { role: _role, ...r } = await loadReport(id, email);
  return r;
}

async function checkSource(databaseId: string, email: string, raw: unknown): Promise<ReportSource> {
  const s = (raw ?? {}) as { kind?: unknown; id?: unknown };
  const kind = s.kind === "query" ? "query" : "table";
  const id = String(s.id ?? "");
  const exists = kind === "table" ? (await listTables(databaseId, email)).some((t) => t.id === id) : (await listQueries(databaseId, email)).some((q) => q.id === id);
  if (!exists) throw new FieldValueError(`Pick the ${kind} the report shows`);
  return { kind, id };
}

async function checkName(databaseId: string, name: string, except?: string) {
  const { rows } = await db().q(`SELECT 1 FROM base_reports WHERE database_id = $1 AND lower(name) = lower($2) AND id <> $3`, [databaseId, name, except ?? ""]);
  if (rows[0]) throw new FieldValueError(`There's already a report called ${name}`);
}

export async function createReport(databaseId: string, email: string, input: { name?: unknown; source?: unknown; layout?: unknown }): Promise<ReportInfo> {
  const info = await member(databaseId, email);
  if (!canEdit(info.role)) throw forbidden();
  const name = cleanName(input.name, "Report name");
  await checkName(databaseId, name);
  const source = await checkSource(databaseId, email, input.source);
  const { rows } = await db().q(
    `INSERT INTO base_reports (id, database_id, name, source_kind, source_id, layout, position)
     VALUES ($1, $2, $3, $4, $5, $6, (SELECT coalesce(max(position) + 1, 0) FROM base_reports WHERE database_id = $2)) RETURNING *`,
    [newId(), databaseId, name, source.kind, source.id, cleanReportLayout(input.layout)],
  );
  return reportRow(rows[0]);
}

export async function updateReport(id: string, email: string, input: { name?: unknown; source?: unknown; layout?: unknown; position?: unknown }): Promise<ReportInfo> {
  const r = await loadReport(id, email);
  if (!canEdit(r.role)) throw forbidden();
  const name = input.name === undefined ? r.name : cleanName(input.name, "Report name");
  if (name.toLowerCase() !== r.name.toLowerCase()) await checkName(r.databaseId, name, id);
  const source = input.source === undefined ? r.source : await checkSource(r.databaseId, email, input.source);
  const layout = input.layout === undefined ? r.layout : cleanReportLayout(input.layout);
  const position = Number.isInteger(input.position) ? (input.position as number) : r.position;
  const { rows } = await db().q(
    `UPDATE base_reports SET name = $2, source_kind = $3, source_id = $4, layout = $5, position = $6, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, name, source.kind, source.id, layout, position],
  );
  return reportRow(rows[0]);
}

export async function deleteReport(id: string, email: string): Promise<void> {
  const r = await loadReport(id, email);
  if (!canEdit(r.role)) throw forbidden();
  await db().q(`DELETE FROM base_reports WHERE id = $1`, [id]);
}

const FIELD_FORMATS: Partial<Record<Field["type"], Format>> = { currency: "currency", date: "date" };

/**
 * The SELECT a report runs for a table: every field by name, with each lookup replaced by its
 * related record's display field (a multi-value lookup's, joined by "; ").
 */
export function tableSql(t: TableInfo, tables: TableInfo[]): string {
  const cols = t.fields.map((f) => {
    const target = f.type === "lookup" || f.type === "multilookup" ? tables.find((x) => x.id === f.options.targetTable) : undefined;
    const display = target?.fields.find((x) => x.id === f.options.displayField);
    if (!target || !display) return `t.${quoteName(f.name)}`;
    const shown = display.type === "multichoice" ? `array_to_string(d.${quoteName(display.name)}, '; ')` : `d.${quoteName(display.name)}::text`;
    const id = `d.${quoteName(target.fields.find((x) => x.type === "autonumber")!.name)}`;
    const mine = `t.${quoteName(f.name)}`;
    if (f.type === "multilookup") {
      // The related records' text, in the order they were picked, as "Ada; Bob".
      return `array_to_string(ARRAY(SELECT ${shown} FROM ${quoteName(target.name)} d WHERE ${id} = ANY(${mine}) ORDER BY array_position(${mine}, ${id})), '; ') AS ${quoteName(f.name)}`;
    }
    return `(SELECT ${shown} FROM ${quoteName(target.name)} d WHERE ${id} = ${mine}) AS ${quoteName(f.name)}`;
  });
  return `SELECT ${cols.join(", ")} FROM ${quoteName(t.name)} t`;
}

/** Runs the report's source and lays it out; `layout` previews an unsaved design. */
export async function runReport(id: string, email: string, layout?: unknown): Promise<ReportData> {
  const r = await loadReport(id, email);
  const tables = await listTables(r.databaseId, email);
  let sql: string;
  const formats = new Map<string, Format>();
  if (r.source.kind === "table") {
    const t = tables.find((x) => x.id === r.source.id);
    if (!t) throw new HttpError(400, "The table this report shows was deleted; pick another in Design view");
    sql = tableSql(t, tables);
    for (const f of t.fields) {
      const fmt = FIELD_FORMATS[f.type];
      if (fmt) formats.set(f.name, fmt);
    }
    if (t.fields.some((f) => f.type === "currency" && f.options.currencyCode && f.options.currencyCode !== "USD")) {
      // A report shows one currency; take the table's when the layout doesn't say.
      const code = t.fields.find((f) => f.type === "currency" && f.options.currencyCode)!.options.currencyCode;
      layout = { currencyCode: code, ...((layout ?? r.layout) as object) };
    }
  } else {
    const q = (await listQueries(r.databaseId, email)).find((x) => x.id === r.source.id);
    if (!q) throw new HttpError(400, "The query this report shows was deleted; pick another in Design view");
    sql = `SELECT * FROM ${quoteName(q.name)}`;
  }
  const result = await runQuery(r.databaseId, email, { kind: "sql", sql }, { maxRows: MAX_REPORT_ROWS });
  const source: SourceColumn[] = result.columns.map((c) => ({ name: c.name, kind: c.kind, format: formats.get(c.name) }));
  return buildReport(r.name, source, result.rows, layout === undefined ? r.layout : cleanReportLayout(layout), result.truncated);
}
