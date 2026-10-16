"use client";

// Table tools (shown while a table is selected): rows and columns around the
// current cell, merge/split, cell fill, borders, alignment and cell text style.
import { useState } from "react";
import type { CellBorder, TableEl, TableStyle } from "@/lib/slides/model";
import { BUILTIN_STYLES, lookOf, styleAt, validTableStyle } from "@/lib/slides/table-style";
import {
  BORDER_MODES,
  DEFAULT_BORDER,
  deleteCol,
  deleteRow,
  expandRect,
  gridCols,
  insertCol,
  insertRow,
  mergeCells,
  normalizeTable,
  patchCells,
  setBorders,
  splitCell,
  type CellRect,
} from "@/lib/slides/table";
import { Popover, Swatches, TB } from "./SlideToolbar";

/** The rich-text field of a table cell that has the caret, if any. */
function activeCellField(): HTMLElement | null {
  const a = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
  return a?.dataset?.testid === "table-cell" ? a : null;
}
const hasTextSelection = () => {
  const s = window.getSelection();
  return !!activeCellField() && !!s && !s.isCollapsed;
};

const STYLE_FLAGS: [keyof TableStyle, string][] = [
  ["first", "Header row"],
  ["last", "Total row"],
  ["bandRow", "Banded rows"],
  ["firstCol", "First column"],
  ["lastCol", "Last column"],
  ["bandCol", "Banded columns"],
];

/** A small picture of a table style (4 x 5 cells) with the table's parts on. */
function StylePreview({ ts, theme }: { ts: TableStyle; theme: { accent: string; text: string; bg: string } }) {
  const look = lookOf(ts, theme.accent, theme.text, theme.bg);
  return (
    <div className="grid grid-cols-5 gap-px w-[60px] h-[34px]" aria-hidden>
      {Array.from({ length: 20 }, (_, k) => {
        const r = Math.floor(k / 5), c = k % 5;
        const s = styleAt(ts, look, r, c, 4, 5);
        return <span key={k} style={{ background: s.fill ? `#${s.fill}` : "transparent", outline: s.line ? `1px solid #${s.line}` : undefined }} />;
      })}
    </div>
  );
}

/** Table Design: the table's style and the parts it turns on. */
function TableDesign({ el, onPatch, theme }: { el: TableEl; onPatch: (p: Partial<TableEl>) => void; theme: { accent: string; text: string; bg: string } }) {
  const cur = validTableStyle(el.tstyle) ? el.tstyle : undefined;
  const flags: Partial<TableStyle> = cur ?? { first: true, bandRow: true };
  const own = cur && !BUILTIN_STYLES.some((b) => b.id === cur.id) ? [cur] : [];
  const pick = (id: string | null) => {
    if (!id) return onPatch({ tstyle: undefined });
    const keep = own.find((o) => o.id === id);
    const { look: _l, name: _n, id: _i, ...f } = { ...flags } as TableStyle;
    onPatch({ tstyle: keep ? { ...keep, ...f } : { id, ...f } });
  };
  const options: { id: string | null; name: string; ts?: TableStyle }[] = [
    { id: null, name: "None (cell formatting only)" },
    ...own.map((o) => ({ id: o.id, name: o.name || "This deck's style", ts: o })),
    ...BUILTIN_STYLES.map((b) => ({ id: b.id, name: b.name, ts: { ...flags, id: b.id } as TableStyle })),
  ];
  return (
    <div className="space-y-2 text-sm w-[260px]">
      <div className="grid grid-cols-3 gap-1">
        {options.map((o) => (
          <button
            key={o.id || "none"}
            type="button"
            title={o.name}
            data-testid={`table-style-${o.id ? o.id.slice(1, 9).toLowerCase() : "none"}`}
            aria-pressed={(cur?.id ?? null) === o.id}
            className={`p-1 rounded border ${(cur?.id ?? null) === o.id ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"}`}
            onClick={() => pick(o.id)}
          >
            {o.ts ? <StylePreview ts={{ ...o.ts, ...flags, id: o.ts.id, look: o.ts.look }} theme={theme} /> : <div className="w-[60px] h-[34px] grid place-items-center text-[10px] text-slate-500">None</div>}
          </button>
        ))}
      </div>
      <div className="border-t border-slate-100 pt-2 grid grid-cols-2 gap-1">
        {STYLE_FLAGS.map(([k, label]) => (
          <label key={k} className="flex items-center gap-1.5 text-xs text-slate-700">
            <input
              type="checkbox"
              data-testid={`table-flag-${k}`}
              disabled={!cur}
              checked={!!cur?.[k]}
              onChange={(ev) => cur && onPatch({ tstyle: { ...cur, [k]: ev.target.checked || undefined } })}
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}

export function TableTools({ el, sel, onPatch, onSel, theme }: { el: TableEl; sel: CellRect | null; onPatch: (p: Partial<TableEl>) => void; onSel: (r: CellRect | null) => void; theme?: { accent: string; text: string; bg: string } }) {
  const rows = normalizeTable(el.rows);
  const nc = gridCols(rows);
  const rect = sel ? expandRect(rows, sel) : { r0: rows.length - 1, c0: nc - 1, r1: rows.length - 1, c1: nc - 1 };
  const single = rect.r0 === rect.r1 && rect.c0 === rect.c1;
  const anchor = rows[rect.r0]?.[rect.c0];
  const isMerged = !!anchor && ((anchor.cs || 1) > 1 || (anchor.rs || 1) > 1);
  const [line, setLine] = useState<CellBorder>({ c: el.border || DEFAULT_BORDER, w: 1 });
  const cells = (fn: Parameters<typeof patchCells>[2]) => onPatch({ rows: patchCells(rows, rect, fn) });
  /** Text style: on selected text inside a cell when there is some, else on the whole selected cells. */
  const textCmd = (cmd: "bold" | "italic" | "underline") => {
    if (hasTextSelection()) {
      document.execCommand("styleWithCSS", false, "false");
      document.execCommand(cmd);
      return;
    }
    if (cmd === "bold") {
      const on = !anchor?.bold;
      cells((c) => ({ ...c, bold: on || undefined }));
    } else {
      const tag = cmd === "italic" ? "em" : "u";
      cells((c) => {
        const html = c.html || c.text.split("\n").map((l) => `<p>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`).join("");
        if (!html) return c;
        const has = new RegExp(`<${tag}>`).test(html);
        const next = has ? html.replace(new RegExp(`</?${tag}>`, "g"), "") : html.replace(/<p([^>]*)>([\s\S]*?)<\/p>/g, (_, a, inner) => `<p${a}><${tag}>${inner}</${tag}></p>`);
        return { ...c, html: next };
      });
    }
  };
  const textColor = (hex: string | null) => {
    if (hasTextSelection() && hex) {
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand("foreColor", false, `#${hex}`);
      return;
    }
    cells((c) => ({ ...c, color: hex || undefined }));
  };
  const rowOp = (op: "above" | "below" | "left" | "right" | "delRow" | "delCol") => {
    if (op === "above" || op === "below") {
      const at = op === "above" ? rect.r0 : rect.r1 + 1;
      onPatch(insertRow(el, at));
      onSel(null);
    } else if (op === "left" || op === "right") {
      onPatch(insertCol(el, op === "left" ? rect.c0 : rect.c1 + 1));
      onSel(null);
    } else if (op === "delRow") {
      let cur: TableEl = el;
      for (let r = rect.r1; r >= rect.r0; r--) {
        const p = deleteRow(cur, r);
        if (p) cur = { ...cur, ...p };
      }
      onPatch({ rows: cur.rows, rowH: cur.rowH, h: cur.h });
      onSel(null);
    } else {
      let cur: TableEl = el;
      for (let c = rect.c1; c >= rect.c0; c--) {
        const p = deleteCol(cur, c);
        if (p) cur = { ...cur, ...p };
      }
      onPatch({ rows: cur.rows, colW: cur.colW });
      onSel(null);
    }
  };
  const item = "text-left text-sm px-2 py-1.5 rounded hover:bg-slate-50 whitespace-nowrap";
  return (
    <>
      <Popover label={<span>Table Design</span>} title="Table style, header row, total row and banding" testId="tb-table-design" wide>
        {() => <TableDesign el={el} onPatch={onPatch} theme={theme || { accent: "4472C4", text: "000000", bg: "FFFFFF" }} />}
      </Popover>
      <Popover label={<span>Rows &amp; columns</span>} title="Insert or delete rows and columns" testId="tb-table-rows">
        {(close) => (
          <div className="flex flex-col">
            {([
              ["above", "Insert row above"],
              ["below", "Insert row below"],
              ["left", "Insert column left"],
              ["right", "Insert column right"],
              ["delRow", "Delete rows"],
              ["delCol", "Delete columns"],
            ] as const).map(([k, l]) => (
              <button key={k} type="button" data-testid={`table-${k}`} className={item} onClick={() => { rowOp(k); close(); }}>{l}</button>
            ))}
            <div className="h-px bg-slate-100 my-1" />
            <button type="button" className={item} data-testid="table-even-cols" onClick={() => { onPatch({ colW: undefined }); close(); }}>Distribute columns evenly</button>
            <button type="button" className={item} data-testid="table-even-rows" onClick={() => { onPatch({ rowH: undefined }); close(); }}>Distribute rows evenly</button>
          </div>
        )}
      </Popover>
      <TB title="Merge cells" testId="table-merge" disabled={single} onClick={() => { onPatch({ rows: mergeCells(rows, rect) }); onSel({ r0: rect.r0, c0: rect.c0, r1: rect.r0, c1: rect.c0 }); }}>Merge</TB>
      <TB title="Split cells" testId="table-split" disabled={!isMerged} onClick={() => onPatch({ rows: splitCell(rows, rect.r0, rect.c0) })}>Split</TB>
      <Popover label={<span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm border border-slate-300" style={{ background: anchor?.fill ? `#${anchor.fill}` : "transparent" }} />Cell fill</span>} title="Cell fill" testId="tb-cell-fill">
        {(close) => <Swatches value={anchor?.fill} allowNone onPick={(c) => { cells((x) => ({ ...x, fill: c || undefined })); close(); }} />}
      </Popover>
      <Popover label={<span>Borders</span>} title="Cell borders" testId="tb-cell-borders" wide>
        {(close) => (
          <div className="space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-0.5">
              {BORDER_MODES.map((m) => (
                <button key={m.id} type="button" data-testid={`border-${m.id}`} className={item} onClick={() => { onPatch({ rows: setBorders(rows, rect, m.id, line) }); close(); }}>{m.label}</button>
              ))}
            </div>
            <div className="border-t border-slate-100 pt-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-1">Line</div>
              <div className="flex items-center gap-1 text-xs text-slate-600 mb-2">
                Width
                {[0.5, 1, 2, 3, 4.5, 6].map((w) => (
                  <button key={w} type="button" data-testid={`border-w-${w}`} className={`px-1.5 py-0.5 rounded border ${line.w === w ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"}`} onClick={() => setLine((l) => ({ ...l, w }))}>{w}</button>
                ))}
              </div>
              <Swatches value={line.c} onPick={(c) => c && setLine((l) => ({ ...l, c }))} />
            </div>
          </div>
        )}
      </Popover>
      <TB title="Bold cell text" testId="cell-bold" active={!!anchor?.bold} onClick={() => textCmd("bold")}><b>B</b></TB>
      <TB title="Italic cell text" testId="cell-italic" onClick={() => textCmd("italic")}><i>I</i></TB>
      <TB title="Underline cell text" testId="cell-underline" onClick={() => textCmd("underline")}><u>U</u></TB>
      <Popover label={<span className="font-semibold" style={{ color: anchor?.color ? `#${anchor.color}` : undefined }}>A</span>} title="Cell text colour" testId="tb-cell-color">
        {(close) => <Swatches value={anchor?.color} allowNone noneLabel="Automatic" onPick={(c) => { textColor(c); close(); }} />}
      </Popover>
      <Popover label={<span>Align</span>} title="Cell alignment" testId="tb-cell-align">
        {(close) => (
          <div className="flex flex-col">
            {(["left", "center", "right"] as const).map((a) => (
              <button key={a} type="button" data-testid={`cell-align-${a}`} className={item} onClick={() => { cells((c) => ({ ...c, align: a === "left" ? undefined : a })); close(); }}>{a === "left" ? "Align left" : a === "center" ? "Center" : "Align right"}</button>
            ))}
            <div className="h-px bg-slate-100 my-1" />
            {(["top", "middle", "bottom"] as const).map((v) => (
              <button key={v} type="button" data-testid={`cell-valign-${v}`} className={item} onClick={() => { cells((c) => ({ ...c, valign: v === "middle" ? undefined : v })); close(); }}>{v === "top" ? "Align top" : v === "middle" ? "Align middle" : "Align bottom"}</button>
            ))}
          </div>
        )}
      </Popover>
    </>
  );
}
