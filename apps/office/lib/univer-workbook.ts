// Creating a workbook from a saved snapshot, with fixes for state Univer
// doesn't restore by itself.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Api = { createWorkbook: (snap: any) => any; syncExecuteCommand?: (id: string, params?: any, options?: any) => any; getFormula?: () => any };

/** Univer 0.25 re-creates saved tables with the default look instead of the
 *  saved one. Put each table's look back. It is applied locally on every
 *  client (onlyLocal), so it is not sent to collaborators as an edit. */
function restoreTableLooks(api: Api, unitId: string, snap: any) {
  const res = (snap?.resources || []).find((r: any) => r?.name === "SHEET_TABLE_PLUGIN");
  if (!res?.data) return;
  let data: Record<string, { tables?: any[] }>;
  try {
    data = JSON.parse(res.data);
  } catch {
    return;
  }
  for (const [subUnitId, sheet] of Object.entries(data || {})) {
    for (const t of sheet?.tables || []) {
      const theme = t?.options?.tableStyleId;
      if (!t?.id || !theme) continue;
      try {
        api.syncExecuteCommand?.("sheet.mutation.set-sheet-table", { unitId, subUnitId, tableId: t.id, config: { theme } }, { onlyLocal: true });
      } catch {
        /* table plugin not loaded or table gone */
      }
    }
  }
}

// Comment threads live in the database (lib/sheet-comments.ts); a copy that
// an older save left in the snapshot would show deleted or stale threads.
const COMMENTS_RESOURCE = "SHEET_UNIVER_THREAD_COMMENT_PLUGIN";

/**
 * `replaced`: the workbook takes the place of one with the same id (an opened
 * file, a restored version, a collaborator's replacement). The formula engine
 * keeps the old workbook's dynamic-array spills under that id and would not
 * show the new ones, so everything is worked out again.
 */
export function createWorkbookFromSnapshot(api: Api, snap: any, options: { replaced?: boolean } = {}) {
  if (Array.isArray(snap?.resources) && snap.resources.some((r: any) => r?.name === COMMENTS_RESOURCE))
    snap = { ...snap, resources: snap.resources.filter((r: any) => r?.name !== COMMENTS_RESOURCE) };
  const wb = api.createWorkbook(snap);
  const unitId = wb?.getId?.() || snap?.id;
  if (unitId) restoreTableLooks(api, unitId, snap);
  if (options.replaced)
    setTimeout(() => {
      try {
        api.getFormula?.()?.executeCalculation?.();
      } catch {
        /* the next edit recalculates */
      }
    }, 0);
  return wb;
}
