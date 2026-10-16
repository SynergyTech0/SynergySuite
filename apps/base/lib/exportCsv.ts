/** A table or saved query as CSV: for downloads, and for data links Sheets reads. */
import type { TableRef } from "./catalog";
import { csvLine, exportValue } from "./csv";
import type { FilterSpec, SortSpec } from "./filter";
import { MAX_EXPORT_ROWS, runQuery, type QueryInfo } from "./queries";
import { allRows } from "./rows";

/** Every record matching the view, streamed, with lookups shown by their related record. */
export function tableCsv(t: TableRef, opts: { filter?: FilterSpec | null; sort?: SortSpec | null; search?: string | null } = {}): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const rows = allRows(t, opts);
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode("﻿" + csvLine(t.fields.map((f) => f.name))));
    },
    async pull(c) {
      const next = await rows.next();
      if (next.done) return c.close();
      c.enqueue(enc.encode(csvLine(t.fields.map((f) => exportValue(f, next.value.values[f.id], next.value.labels?.[f.id])))));
    },
  });
}

/** A saved query's results (up to 200,000 rows). */
export async function queryCsv(q: Pick<QueryInfo, "id" | "databaseId">, email: string): Promise<string> {
  const parts: string[] = ["﻿"];
  await runQuery(q.databaseId, email, { queryId: q.id }, {
    maxRows: MAX_EXPORT_ROWS,
    timeoutMs: 60_000,
    onBatch: async (rows, columns) => {
      if (parts.length === 1) parts.push(csvLine(columns.map((c) => c.name)));
      for (const r of rows) parts.push(csvLine(r.map((v) => (Array.isArray(v) ? v.join("; ") : v))));
    },
  });
  return parts.join("");
}

export const csvHeaders = (name: string, download = true) => ({
  "Content-Type": "text/csv; charset=utf-8",
  ...(download ? { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${name}.csv`)}` } : {}),
});
