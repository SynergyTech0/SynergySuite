// Custom views (View > Custom Views in Excel): named snapshots of how the
// workbook looks (which sheet is open, and on each sheet the hidden rows and
// columns, frozen panes, zoom, gridlines, selection and whether the sheet is
// hidden), to switch between later. They live in a workbook resource. In
// .xlsx each is a customWorkbookView with a customSheetView on every sheet,
// as Excel writes them; the hidden rows and columns go in the view's
// extension list, since Excel's format has no list of them.

export const CUSTOM_VIEWS_RESOURCE = "SHEET_SYNERGY_CUSTOM_VIEWS_PLUGIN";
export const SET_CUSTOM_VIEWS_MUTATION = "sheet.mutation.set-custom-views";

export type Rect = { startRow: number; endRow: number; startColumn: number; endColumn: number };
export type SheetView = {
  hiddenRows: number[];
  hiddenColumns: number[];
  /** Frozen rows and columns at the top left (0 for none). */
  frozenRows: number;
  frozenColumns: number;
  zoom: number;
  gridlines: boolean;
  hidden?: boolean;
  selection?: Rect;
};
export type CustomView = { id: string; name: string; activeSheetId?: string; sheets: Record<string, SheetView> };

type SheetSnap = { name?: string; hidden?: number; rowData?: Record<string, { hd?: number }>; columnData?: Record<string, { hd?: number }>; freeze?: { xSplit?: number; ySplit?: number }; zoomRatio?: number; showGridlines?: number };

const hiddenOf = (data: Record<string, { hd?: number }> | undefined) =>
  Object.entries(data || {})
    .filter(([, v]) => v?.hd === 1)
    .map(([k]) => Number(k))
    .sort((a, b) => a - b);

/** The view of a workbook snapshot right now. */
export function captureView(name: string, sheets: Record<string, SheetSnap>, activeSheetId: string | undefined, selections: Record<string, Rect | undefined> = {}, id = newGuid()): CustomView {
  const out: CustomView = { id, name, ...(activeSheetId ? { activeSheetId } : {}), sheets: {} };
  for (const [sid, s] of Object.entries(sheets)) {
    out.sheets[sid] = {
      hiddenRows: hiddenOf(s.rowData),
      hiddenColumns: hiddenOf(s.columnData),
      frozenRows: Math.max(0, s.freeze?.ySplit || 0),
      frozenColumns: Math.max(0, s.freeze?.xSplit || 0),
      zoom: s.zoomRatio || 1,
      gridlines: s.showGridlines !== 0,
      ...(s.hidden === 1 ? { hidden: true } : {}),
      ...(selections[sid] ? { selection: selections[sid] } : {}),
    };
  }
  return out;
}

/** Runs of numbers: [start, count] pairs. */
export function runsOf(nums: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const n of [...new Set(nums)].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && last[0] + last[1] === n) last[1]++;
    else out.push([n, 1]);
  }
  return out;
}

export function newGuid(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `{${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}}`;
}

// ---- .xlsx ----------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const col = (c: number) => {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const colIndex = (s: string) => s.toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const cell = (r: number, c: number) => `${col(c)}${r + 1}`;
const parseCell = (s: string) => {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(s);
  return m ? { row: Number(m[2]) - 1, column: colIndex(m[1]) } : null;
};
const attrsOf = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], unesc(m[2])]));
const EXT_URI = "{8A3D5E21-6C47-4B9F-9E12-5D0C7B3A4F68}";

/** One sheet's <customSheetView> for a view. */
export function customSheetViewXml(guid: string, v: SheetView): string {
  const a: string[] = [`guid="${esc(guid)}"`];
  if (Math.round(v.zoom * 100) !== 100) a.push(`scale="${Math.round(v.zoom * 100)}"`);
  if (!v.gridlines) a.push(`showGridLines="0"`);
  if (v.hiddenRows.length) a.push(`hiddenRows="1"`);
  if (v.hiddenColumns.length) a.push(`hiddenColumns="1"`);
  if (v.hidden) a.push(`state="hidden"`);
  let inner = "";
  const fr = v.frozenRows;
  const fc = v.frozenColumns;
  if (fr || fc) {
    const pane = fr && fc ? "bottomRight" : fr ? "bottomLeft" : "topRight";
    inner += `<pane${fc ? ` xSplit="${fc}"` : ""}${fr ? ` ySplit="${fr}"` : ""} topLeftCell="${cell(fr, fc)}" activePane="${pane}" state="frozen"/>`;
  }
  if (v.selection) {
    const s = v.selection;
    const ref = s.startRow === s.endRow && s.startColumn === s.endColumn ? cell(s.startRow, s.startColumn) : `${cell(s.startRow, s.startColumn)}:${cell(s.endRow, s.endColumn)}`;
    const pane = fr && fc ? "bottomRight" : fr ? "bottomLeft" : fc ? "topRight" : "";
    inner += `<selection${pane ? ` pane="${pane}"` : ""} activeCell="${cell(s.startRow, s.startColumn)}" sqref="${ref}"/>`;
  }
  return `<customSheetView ${a.join(" ")}>${inner}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></customSheetView>`;
}

// Where customSheetViews goes among a worksheet's children.
const SHEET_AFTER = /<(?:mergeCells|phoneticPr|conditionalFormatting|dataValidations|hyperlinks|printOptions|pageMargins|pageSetup|headerFooter|rowBreaks|colBreaks|customProperties|cellWatches|ignoredErrors|smartTags|drawing|legacyDrawing|legacyDrawingHF|drawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/;
const BOOK_AFTER = /<(?:pivotCaches|smartTagPr|smartTagTypes|webPublishing|fileRecoveryPr|webPublishObjects|extLst)\b/;
const insertBefore = (xml: string, re: RegExp, close: string, insert: string) => {
  const m = re.exec(xml);
  const at = m ? m.index : xml.lastIndexOf(close);
  return at < 0 ? xml : xml.slice(0, at) + insert + xml.slice(at);
};

/** Writes the views into a worksheet. `sheetId` is the sheet's id in the views. */
export function patchSheetCustomViews(sheetXml: string, views: CustomView[], sheetId: string): string {
  const xml = sheetXml.replace(/<customSheetViews>[\s\S]*?<\/customSheetViews>/g, "");
  const inner = views
    .filter((v) => v.sheets[sheetId])
    .map((v) => customSheetViewXml(v.id, v.sheets[sheetId]))
    .join("");
  return inner ? insertBefore(xml, SHEET_AFTER, "</worksheet>", `<customSheetViews>${inner}</customSheetViews>`) : xml;
}

/**
 * Writes <customWorkbookViews> into workbook.xml. `order` is the sheet ids in
 * tab order (the extension stores sheets by position, as ids change on import).
 */
export function patchWorkbookCustomViews(workbookXml: string, views: CustomView[], order: string[]): string {
  const xml = workbookXml.replace(/<customWorkbookViews>[\s\S]*?<\/customWorkbookViews>/g, "");
  if (!views.length) return xml;
  const sheetIds = [...xml.matchAll(/<sheet\b[^>]*>/g)].map((m) => attrsOf(m[0]).sheetId);
  const inner = views
    .map((v) => {
      const at = Math.max(0, order.indexOf(v.activeSheetId || ""));
      const byIndex = order.map((id) => v.sheets[id] || null);
      const ext = `<extLst><ext uri="${EXT_URI}" xmlns:sv="urn:synergy:custom-view"><sv:view>${esc(JSON.stringify(byIndex))}</sv:view></ext></extLst>`;
      return `<customWorkbookView name="${esc(v.name.slice(0, 255))}" guid="${esc(v.id)}" windowWidth="1280" windowHeight="800" activeSheetId="${sheetIds[at] || at + 1}">${ext}</customWorkbookView>`;
    })
    .join("");
  return insertBefore(xml, BOOK_AFTER, "</workbook>", `<customWorkbookViews>${inner}</customWorkbookViews>`);
}

/** Reads the views of an .xlsx: from our extension when there, else from Excel's customSheetViews. */
export function readCustomViews(workbookXml: string, sheetXmls: string[], order: string[]): CustomView[] {
  const sheetTags = [...workbookXml.matchAll(/<sheet\b[^>]*>/g)].map((m) => attrsOf(m[0]).sheetId);
  const out: CustomView[] = [];
  for (const m of workbookXml.matchAll(/<customWorkbookView\b[^>]*?(?:\/>|>[\s\S]*?<\/customWorkbookView>)/g)) {
    const a = attrsOf(/<customWorkbookView\b[^>]*>/.exec(m[0])![0]);
    if (!a.guid) continue;
    const at = sheetTags.indexOf(a.activeSheetId);
    const view: CustomView = { id: a.guid, name: a.name || "View", ...(at >= 0 && order[at] ? { activeSheetId: order[at] } : {}), sheets: {} };
    const ext = /<sv:view>([\s\S]*?)<\/sv:view>/.exec(m[0])?.[1];
    let mine: (SheetView | null)[] | null = null;
    try {
      mine = ext ? JSON.parse(unesc(ext)) : null;
    } catch {
      mine = null;
    }
    order.forEach((sid, i) => {
      if (mine) {
        if (mine[i]) view.sheets[sid] = mine[i]!;
        return;
      }
      const sv = [...(sheetXmls[i] || "").matchAll(/<customSheetView\b[^>]*?(?:\/>|>[\s\S]*?<\/customSheetView>)/g)].find((x) => attrsOf(/<customSheetView\b[^>]*>/.exec(x[0])![0]).guid === a.guid)?.[0];
      if (!sv) return;
      const s = attrsOf(/<customSheetView\b[^>]*>/.exec(sv)![0]);
      const pane = /<pane\b[^>]*>/.exec(sv)?.[0];
      const p = pane ? attrsOf(pane) : {};
      const frozen = pane && /frozen/.test(p.state || "");
      const sel = /<selection\b[^>]*>/.exec(sv)?.[0];
      const sq = sel ? (attrsOf(sel).sqref || "").split(/\s+/)[0] : "";
      const [c1, c2] = sq.split(":").map(parseCell);
      view.sheets[sid] = {
        hiddenRows: [],
        hiddenColumns: [],
        frozenRows: frozen ? Number(p.ySplit) || 0 : 0,
        frozenColumns: frozen ? Number(p.xSplit) || 0 : 0,
        zoom: s.scale ? Number(s.scale) / 100 : 1,
        gridlines: s.showGridLines !== "0" && s.showGridLines !== "false",
        ...(s.state === "hidden" || s.state === "veryHidden" ? { hidden: true } : {}),
        ...(c1 ? { selection: { startRow: c1.row, startColumn: c1.column, endRow: (c2 || c1).row, endColumn: (c2 || c1).column } } : {}),
      };
    });
    out.push(view);
  }
  return out;
}

/** Views after a structural change: a removed sheet leaves every view. */
export function foldCustomViews(list: CustomView[], op: { id: string; params?: { subUnitId?: string } }): CustomView[] {
  if (op.id !== "sheet.mutation.remove-sheet" || !op.params?.subUnitId) return list;
  const gone = op.params.subUnitId;
  if (!list.some((v) => v.sheets[gone] || v.activeSheetId === gone)) return list;
  return list.map((v) => {
    const sheets = { ...v.sheets };
    delete sheets[gone];
    return { ...v, sheets, ...(v.activeSheetId === gone ? { activeSheetId: undefined } : {}) };
  });
}
