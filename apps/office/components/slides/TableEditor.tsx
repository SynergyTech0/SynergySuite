"use client";

// In-place table editing: every cell is a small rich-text field (bold, italic,
// underline, colour via the table tools), click selects a cell, Shift+click or
// dragging extends the selection to a range, Tab/Shift+Tab move between cells.
// Dragging a border between columns or below a row sizes them.
import { useLayoutEffect, useRef, useState } from "react";
import type { TableCell, TableEl } from "@/lib/slides/model";
import { sanitizeHtml } from "@/lib/slides/sanitize";
import { anchorAt, dragColBorder, dragRowBorder, expandRect, fractions, gridCols, normalizeTable, withHtml, type CellRect } from "@/lib/slides/table";
import { TableView, type DeckLook } from "./SlideView";

function EditableCell({ html, onCommit, onKeyDown, onFocus, r, c }: { html: string; onCommit: (html: string) => void; onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void; onFocus: () => void; r: number; c: number }) {
  const ref = useRef<HTMLDivElement>(null);
  // keep the DOM in step with remote edits, but never under the caret
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || el.ownerDocument.activeElement === el) return;
    const clean = sanitizeHtml(html);
    if (el.innerHTML !== clean) el.innerHTML = clean;
  }, [html]);
  return (
    <div
      ref={ref}
      className="slide-text"
      data-testid="table-cell"
      data-r={r}
      data-c={c}
      contentEditable
      suppressContentEditableWarning
      onFocus={onFocus}
      onInput={(e) => {
        const raw = e.currentTarget.innerHTML;
        // a cell typed into from empty holds bare text: wrap it as a paragraph
        onCommit(sanitizeHtml(/^\s*<(p|ul|ol)[\s>]/i.test(raw) || !raw ? raw : `<p>${raw}</p>`));
      }}
      onKeyDown={onKeyDown}
      style={{ outline: "none", cursor: "text", minHeight: "1.2em" }}
    />
  );
}

export function TableEditor({
  el,
  look,
  sel,
  onSel,
  onChange,
  onAppendRow,
  onResize,
}: {
  el: TableEl;
  look: DeckLook;
  sel: CellRect | null;
  onSel: (r: CellRect) => void;
  onChange: (rows: TableCell[][]) => void;
  onAppendRow: () => void;
  /** column widths / row heights (and the table's size) after dragging a border */
  onResize?: (p: Partial<TableEl>) => void;
}) {
  const rows = normalizeTable(el.rows);
  const nc = gridCols(rows);
  const box = useRef<HTMLDivElement>(null);
  // a border being dragged: the sizes it shows until the pointer is let go
  const [live, setLive] = useState<Partial<TableEl> | null>(null);
  const shown: TableEl = live ? { ...el, ...live } : el;
  // where each row really ends (text can make a row taller than set), in table px
  const [rowEnds, setRowEnds] = useState<number[]>([]);
  useLayoutEffect(() => {
    const root = box.current;
    const t = root?.querySelector("table");
    if (!root || !t) return;
    const rb = root.getBoundingClientRect();
    const k = rb.height ? shown.h / rb.height : 1;
    const ends = [...t.querySelectorAll(":scope > tbody > tr")].map((tr) => Math.round((tr.getBoundingClientRect().bottom - rb.top) * k * 10) / 10);
    if (ends.join() !== rowEnds.join()) setRowEnds(ends);
  });
  const colWidths = (t: TableEl) => fractions(t.colW, nc).map((f) => f * t.w);
  const rowHeights = () => rowEnds.map((e, k) => e - (k ? rowEnds[k - 1] : 0));
  const startDrag = (e: React.PointerEvent<HTMLDivElement>, kind: "col" | "row", i: number) => {
    e.stopPropagation();
    e.preventDefault();
    const rb = box.current?.getBoundingClientRect();
    if (!rb || !onResize) return;
    const k = kind === "col" ? el.w / rb.width : el.h / rb.height;
    const x0 = e.clientX, y0 = e.clientY;
    const ws = colWidths(el), hs = rowHeights();
    const at = (ev: PointerEvent): Partial<TableEl> => (kind === "col" ? dragColBorder(ws, i, (ev.clientX - x0) * k) : dragRowBorder(hs, i, (ev.clientY - y0) * k));
    let last: Partial<TableEl> | null = null;
    const move = (ev: PointerEvent) => setLive((last = at(ev)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setLive(null);
      if (last) onResize(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const colEdges = fractions(shown.colW, nc).reduce<number[]>((a, f) => [...a, (a.length ? a[a.length - 1] : 0) + f], []);
  const rowLines = live?.rowH ? live.rowH.reduce<number[]>((a, v) => [...a, (a.length ? a[a.length - 1] : 0) + v], []) : rowEnds;
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const range = sel ? expandRect(rows, sel) : null;
  const commit = (ri: number, ci: number, html: string) => {
    const cur = rows[ri]?.[ci];
    if (!cur || (cur.html || "") === html) return;
    const next = withHtml(cur, html);
    if (next.text === cur.text && (next.html || "") === (cur.html || "")) return;
    onChange(rows.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? next : c)) : r)));
  };
  // anchors in reading order, for Tab navigation
  const order: [number, number][] = [];
  rows.forEach((r, ri) => r.forEach((c, ci) => !c.merged && order.push([ri, ci])));
  const focusCell = (ri: number, ci: number, root: HTMLElement | null) => {
    const t = root?.closest("table")?.querySelector<HTMLDivElement>(`[data-testid="table-cell"][data-r="${ri}"][data-c="${ci}"]`);
    if (!t) return;
    t.focus();
    const range = document.createRange();
    range.selectNodeContents(t);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(range);
  };
  const onKey = (ri: number, ci: number) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.key !== "Tab") return;
    e.preventDefault();
    const k = order.findIndex(([y, x]) => y === ri && x === ci);
    const n = order[k + (e.shiftKey ? -1 : 1)];
    if (n) {
      onSel({ r0: n[0], c0: n[1], r1: n[0], c1: n[1] });
      focusCell(n[0], n[1], e.currentTarget);
    } else if (!e.shiftKey) onAppendRow();
  };
  const at = (e: React.PointerEvent): [number, number] | null => {
    const td = (e.target as HTMLElement).closest("td[data-cell]") as HTMLElement | null;
    if (!td) return null;
    const [r, c] = (td.dataset.cell || "").split(":").map(Number);
    return [r, c];
  };
  return (
    <div
      ref={box}
      style={{ position: "absolute", inset: 0 }}
      onPointerDown={(e) => {
        e.stopPropagation();
        const p = at(e);
        if (!p) return;
        if (e.shiftKey && sel) {
          e.preventDefault();
          onSel({ r0: sel.r0, c0: sel.c0, r1: p[0], c1: p[1] });
        } else {
          onSel({ r0: p[0], c0: p[1], r1: p[0], c1: p[1] });
          setDrag(p);
        }
      }}
      onPointerMove={(e) => {
        if (!drag || !(e.buttons & 1)) return;
        const p = at(e);
        if (p && (p[0] !== drag[0] || p[1] !== drag[1])) {
          // dragging across cells selects a range (and leaves text editing)
          (document.activeElement as HTMLElement | null)?.blur?.();
          window.getSelection()?.removeAllRanges();
          onSel({ r0: drag[0], c0: drag[1], r1: p[0], c1: p[1] });
        }
      }}
      onPointerUp={() => setDrag(null)}
    >
      {onResize &&
        colEdges.map((f, i) => (
          <div key={`c${i}`} data-testid="table-col-handle" data-i={i} title="Drag to size the columns" onPointerDown={(e) => startDrag(e, "col", i)} style={{ position: "absolute", top: 0, bottom: 0, left: `calc(${f * 100}% - 4px)`, width: 8, cursor: "col-resize", zIndex: 3, background: live?.colW ? "rgba(79,70,229,0.25)" : undefined }} />
        ))}
      {onResize &&
        rowLines.map((y, i) => (
          <div key={`r${i}`} data-testid="table-row-handle" data-i={i} title="Drag to size the row" onPointerDown={(e) => startDrag(e, "row", i)} style={{ position: "absolute", left: 0, right: 0, top: `calc(${(y / (shown.h || 1)) * 100}% - 4px)`, height: 8, cursor: "row-resize", zIndex: 3, background: live?.rowH ? "rgba(79,70,229,0.25)" : undefined }} />
        ))}
      <TableView
        el={shown}
        look={look}
        cell={(ri, ci, html) => {
          const [ay, ax] = anchorAt(rows, ri, ci);
          const on = !!range && (range.r0 !== range.r1 || range.c0 !== range.c1) && ay >= range.r0 && ay <= range.r1 && ax >= range.c0 && ax <= range.c1;
          return (
            <div style={{ position: "relative" }}>
              {on && <div data-testid="cell-selected" style={{ position: "absolute", inset: "-4px -8px", background: "rgba(79,70,229,0.18)", pointerEvents: "none" }} />}
              <EditableCell html={html} r={ri} c={ci} onCommit={(h) => commit(ri, ci, h)} onKeyDown={onKey(ri, ci)} onFocus={() => { if (!sel || sel.r0 !== sel.r1 || sel.c0 !== sel.c1 || sel.r0 !== ri || sel.c0 !== ci) onSel({ r0: ri, c0: ci, r1: ri, c1: ci }); }} />
            </div>
          );
        }}
      />
    </div>
  );
}
