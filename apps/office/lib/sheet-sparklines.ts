// Sparklines inside the Univer workbook. The groups live in a workbook
// resource and change through one mutation (so they reach collaborators and
// the saved snapshot); a cell-content interceptor draws each sparkline into its
// cell on the canvas, reading the source values as it draws. Inserting or
// deleting rows and columns moves the sparklines and their sources along.
import { rectAfter } from "./protection-rules.mjs";
import { whenSheetsReady } from "./sheet-what-if.ts";
import { drawSparkline, sourceValues, SET_SPARKLINES_MUTATION, SPARKLINE_RESOURCE, type Sparkline, type SparklineGroup, type SparklineResource } from "./sparkline.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export { SET_SPARKLINES_MUTATION };
export type SparklineStore = Map<string, SparklineGroup[]>;

/** Sparkline groups after a structural edit (rows/columns/sheets), or the same list. */
export function foldSparklines(groups: SparklineGroup[], op: { id: string; params?: any }): SparklineGroup[] {
  let changed = false;
  const next: SparklineGroup[] = [];
  for (const g of groups) {
    const items: Sparkline[] = [];
    for (const it of g.items) {
      const cell = rectAfter({ startRow: it.row, endRow: it.row, startColumn: it.column, endColumn: it.column }, g.sheetId, op);
      const source = rectAfter(it.source, it.source.sheetId, op);
      if (!cell || !source) {
        changed = true;
        continue;
      }
      if (cell.startRow !== it.row || cell.startColumn !== it.column || source !== it.source) {
        changed = true;
        items.push({ row: cell.startRow, column: cell.startColumn, source });
      } else items.push(it);
    }
    if (!items.length) continue;
    next.push(items.length === g.items.length && items.every((x, i) => x === g.items[i]) ? g : { ...g, items });
  }
  return changed || next.length !== groups.length ? next : groups;
}

const STRUCTURAL = /^sheet\.mutation\.(insert-row|remove-rows|insert-col|remove-col|move-rows|move-columns|remove-sheet)$/;

/**
 * Registers the resource, the mutation, the drawing interceptor and the
 * follow-the-edits listener; returns a disposer. `sheets` is the
 * @univerjs/sheets module (SheetInterceptorService, INTERCEPTOR_POINT).
 */
export function registerSparklines(injector: any, core: any, sheets: any, store: SparklineStore, onChange: () => void): () => void {
  // unitId -> sheetId -> "row:col" -> what to draw there.
  let index = new Map<string, Map<string, Map<string, { group: SparklineGroup; item: Sparkline }>>>();
  const reindex = () => {
    index = new Map();
    for (const [unitId, groups] of store) {
      const bySheet = new Map<string, Map<string, { group: SparklineGroup; item: Sparkline }>>();
      for (const group of groups) {
        const cells = bySheet.get(group.sheetId) || new Map();
        for (const item of group.items) cells.set(`${item.row}:${item.column}`, { group, item });
        bySheet.set(group.sheetId, cells);
      }
      index.set(unitId, bySheet);
    }
  };
  const changed = () => {
    reindex();
    onChange();
  };

  const resource = injector.get(core.IResourceManagerService).registerPluginResource({
    pluginName: SPARKLINE_RESOURCE,
    businesses: [core.UniverInstanceType.UNIVER_SHEET],
    onLoad: (unitId: string, value: SparklineResource) => {
      store.set(unitId, Array.isArray(value?.groups) ? value.groups : []);
      changed();
    },
    onUnLoad: (unitId: string) => {
      store.delete(unitId);
      changed();
    },
    toJson: (unitId: string) => JSON.stringify({ groups: store.get(unitId) || [] }),
    parseJson: (json: string) => JSON.parse(json) as SparklineResource,
  });
  const commands = injector.get(core.ICommandService);
  const mutation = commands.registerCommand({
    id: SET_SPARKLINES_MUTATION,
    type: core.CommandType.MUTATION,
    handler: (_accessor: unknown, params?: { unitId: string; value: SparklineGroup[] }) => {
      if (!params?.unitId || !Array.isArray(params.value)) return false;
      store.set(params.unitId, params.value);
      changed();
      return true;
    },
  });
  const follow = commands.onCommandExecuted((info: { id: string; params?: any }) => {
    if (!STRUCTURAL.test(info?.id || "")) return;
    const unitId = info.params?.unitId;
    const list = unitId && store.get(unitId);
    if (!list?.length) return;
    const next = foldSparklines(list, info);
    if (next !== list) {
      store.set(unitId, next);
      changed();
    }
  });

  const disposeInterceptor = whenSheetsReady(injector, core, () => injector.get(sheets.SheetInterceptorService).intercept(sheets.INTERCEPTOR_POINT.CELL_CONTENT, {
    effect: core.InterceptorEffectEnum.Style,
    // After number formats, so the cell's own text is already in place.
    priority: (sheets.InterceptCellContentPriority?.NUMFMT ?? 10) + 1,
    handler: (cell: any, pos: any, next: (c: any) => any) => {
      const hit = index.get(pos.unitId)?.get(pos.subUnitId)?.get(`${pos.row}:${pos.col}`);
      if (!hit) return next(cell);
      const workbook = pos.workbook;
      const out = !cell || cell === pos.rawData ? { ...pos.rawData } : cell;
      out.customRender = [
        ...(out.customRender || []),
        {
          zIndex: 1,
          drawWith(ctx: CanvasRenderingContext2D, info: any) {
            const at = info.primaryWithCoord?.isMergedMainCell ? info.primaryWithCoord.mergeInfo : info.primaryWithCoord;
            if (!at) return;
            const src = workbook?.getSheetBySheetId?.(hit.item.source.sheetId);
            if (!src) return;
            const values = sourceValues((r, c) => src.getCellRaw(r, c)?.v, hit.item.source);
            drawSparkline(ctx, { x: at.startX, y: at.startY, w: at.endX - at.startX, h: at.endY - at.startY }, values, hit.group);
          },
        },
      ];
      return next(out);
    },
  }));

  return () => {
    resource.dispose();
    mutation.dispose();
    follow.dispose();
    disposeInterceptor();
  };
}

export const sparklinesIn = (store: SparklineStore, unitId: string | undefined) => (unitId && store.get(unitId)) || [];

export async function saveSparklines(api: any, unitId: string, groups: SparklineGroup[]) {
  const ok = await api.executeCommand(SET_SPARKLINES_MUTATION, { unitId, value: groups });
  if (ok === false) throw new Error("Could not save the sparklines.");
}

/** The groups with any sparkline in the given cells removed (Clear sparklines). */
export function withoutSparklinesIn(groups: SparklineGroup[], sheetId: string, r: { startRow: number; endRow: number; startColumn: number; endColumn: number }): SparklineGroup[] {
  return groups
    .map((g) => (g.sheetId !== sheetId ? g : { ...g, items: g.items.filter((it) => it.row < r.startRow || it.row > r.endRow || it.column < r.startColumn || it.column > r.endColumn) }))
    .filter((g) => g.items.length);
}

/** The group a cell's sparkline belongs to. */
export const groupAt = (groups: SparklineGroup[], sheetId: string, row: number, column: number) =>
  groups.find((g) => g.sheetId === sheetId && g.items.some((it) => it.row === row && it.column === column));
