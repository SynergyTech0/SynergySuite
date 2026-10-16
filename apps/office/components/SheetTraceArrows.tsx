"use client";

// Trace precedents / dependents arrows, drawn over the grid like Excel's:
// a blue arrow from each cell (or boxed range) a formula reads to the formula
// cell, with a dot where it starts. A reference to another sheet is a dashed
// arrow from a small sheet icon. Positions follow scrolling, zoom and resizing.
import { useEffect, useState } from "react";
import type { Arrow } from "@/lib/formula-refs";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Box = { x: number; y: number; w: number; h: number };
type Drawn = { from: Box; to: Box; range: boolean; external: boolean };
type View = { clip: Box; arrows: Drawn[] };

function geometry(api: any, host: HTMLElement) {
  const fs = api?.getActiveWorkbook?.()?.getActiveSheet?.();
  const sk = fs?.getSkeleton?.();
  const canvas = host.querySelector<HTMLCanvasElement>('canvas[id^="univer-sheet-main-canvas"]');
  if (!fs || !sk || !canvas) return null;
  const base = host.getBoundingClientRect();
  const cr = canvas.getBoundingClientRect();
  const left0 = cr.left - base.left;
  const top0 = cr.top - base.top;
  const z = fs.getZoom?.() || 1;
  const rowAcc: ArrayLike<number> = sk.rowHeightAccumulation;
  const colAcc: ArrayLike<number> = sk.columnWidthAccumulation;
  const rowTop = (r: number) => (r <= 0 ? 0 : rowAcc[Math.min(r, rowAcc.length) - 1] ?? 0);
  const colLeft = (c: number) => (c <= 0 ? 0 : colAcc[Math.min(c, colAcc.length) - 1] ?? 0);
  const hdrH = sk.columnHeaderHeight ?? 20;
  const hdrW = sk.rowHeaderWidth ?? 46;
  const scroll = fs.getScrollState?.() || { sheetViewStartRow: 0, sheetViewStartColumn: 0, offsetX: 0, offsetY: 0 };
  const freeze = fs.getFreeze?.() || {};
  const frozenRows = freeze.ySplit > 0 ? freeze.startRow : 0;
  const frozenCols = freeze.xSplit > 0 ? freeze.startColumn : 0;
  const scrollY = Math.max(0, rowTop(scroll.sheetViewStartRow) + scroll.offsetY);
  const scrollX = Math.max(0, colLeft(scroll.sheetViewStartColumn) + scroll.offsetX);
  const yOf = (r: number, edge: number) => top0 + (hdrH + edge - (r >= frozenRows ? scrollY : 0)) * z;
  const xOf = (c: number, edge: number) => left0 + (hdrW + edge - (c >= frozenCols ? scrollX : 0)) * z;
  const box = (r1: number, c1: number, r2 = r1, c2 = c1): Box => {
    const x = xOf(c1, colLeft(c1));
    const y = yOf(r1, rowTop(r1));
    return { x, y, w: xOf(c2, colLeft(c2 + 1)) - x, h: yOf(r2, rowTop(r2 + 1)) - y };
  };
  const clip = { x: left0 + hdrW * z, y: top0 + hdrH * z, w: cr.width - hdrW * z, h: cr.height - hdrH * z };
  return { box, clip, sheetId: fs.getSheetId() as string };
}

function layout(api: any, host: HTMLElement, arrows: Arrow[]): View | null {
  const g = geometry(api, host);
  if (!g) return null;
  const out: Drawn[] = [];
  for (const a of arrows) {
    if (a.to.sheetId !== g.sheetId && a.from.sheetId !== g.sheetId) continue;
    const to = g.box(a.to.row, a.to.column);
    if (a.from.sheetId !== g.sheetId) {
      // A reference on another sheet: dashed arrow from an icon up and left of the cell.
      out.push({ from: { x: to.x - 40, y: to.y - 26, w: 16, h: 12 }, to, range: false, external: true });
      continue;
    }
    if (a.to.sheetId !== g.sheetId) {
      const from = g.box(a.from.startRow, a.from.startColumn);
      out.push({ from, to: { x: from.x + from.w + 24, y: from.y - 26, w: 16, h: 12 }, range: false, external: true });
      continue;
    }
    // Whole rows/columns are clamped to something drawable.
    const r2 = Math.min(a.from.endRow, a.from.startRow + 2000);
    const c2 = Math.min(a.from.endColumn, a.from.startColumn + 500);
    const range = r2 > a.from.startRow || c2 > a.from.startColumn;
    out.push({ from: range ? g.box(a.from.startRow, a.from.startColumn, r2, c2) : g.box(a.from.startRow, a.from.startColumn), to, range, external: false });
  }
  return { clip: g.clip, arrows: out };
}

export default function SheetTraceArrows({ api, host, arrows }: { api: any; host: HTMLElement | null; arrows: Arrow[] }) {
  const [view, setView] = useState<View | null>(null);
  useEffect(() => {
    if (!api || !host || !arrows.length) {
      setView(null);
      return;
    }
    let raf = 0;
    const draw = () => {
      raf = 0;
      try {
        setView(layout(api, host, arrows));
      } catch {
        /* the workbook is being replaced */
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const subs: { dispose?: () => void }[] = [];
    try {
      subs.push(api.onCommandExecuted(schedule));
      if (api.Event?.Scroll) subs.push(api.addEvent(api.Event.Scroll, schedule));
      if (api.Event?.SheetZoomChanged) subs.push(api.addEvent(api.Event.SheetZoomChanged, schedule));
    } catch {
      /* commands still redraw */
    }
    const ro = new ResizeObserver(schedule);
    ro.observe(host);
    schedule();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      subs.forEach((s) => s?.dispose?.());
    };
  }, [api, host, arrows]);

  if (!view || !view.arrows.length) return null;
  const { clip } = view;
  const blue = "#2563eb";
  return (
    <svg className="absolute pointer-events-none z-10" style={{ left: clip.x, top: clip.y, width: Math.max(0, clip.w), height: Math.max(0, clip.h) }} data-trace-arrows aria-hidden="true">
      <defs>
        <marker id="trace-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={blue} />
        </marker>
      </defs>
      <g transform={`translate(${-clip.x} ${-clip.y})`}>
        {view.arrows.map((a, i) => {
          const sx = a.range || a.external ? a.from.x + Math.min(a.from.w, 60) / 2 : a.from.x + a.from.w / 2;
          const sy = a.range || a.external ? a.from.y + Math.min(a.from.h, 20) / 2 : a.from.y + a.from.h / 2;
          const ex = a.to.x + a.to.w / 2;
          const ey = a.to.y + a.to.h / 2;
          return (
            <g key={i} data-trace-arrow>
              {a.range && <rect x={a.from.x + 1} y={a.from.y + 1} width={Math.max(0, a.from.w - 2)} height={Math.max(0, a.from.h - 2)} fill="none" stroke={blue} strokeWidth={1.5} />}
              {a.external && (
                <g>
                  <rect x={a.from.x} y={a.from.y} width={a.from.w} height={a.from.h} fill="#fff" stroke="#334155" strokeWidth={1} />
                  <path d={`M${a.from.x} ${a.from.y + 4}h${a.from.w}M${a.from.x + 5} ${a.from.y}v${a.from.h}`} stroke="#334155" strokeWidth={0.8} />
                </g>
              )}
              <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={blue} strokeWidth={1.5} strokeDasharray={a.external ? "4 3" : undefined} markerEnd="url(#trace-head)" />
              {!a.external && <circle cx={sx} cy={sy} r={3} fill={blue} />}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
