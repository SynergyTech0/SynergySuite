"use client";

// Ribbon-style toolbar for the slide editor: text formatting (applies to the
// text box being edited, else the slide body), insert (text box, picture,
// shapes, table), arrange, shape fill/outline, layout and background.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { CHART_TYPES, LAYOUTS, isCombo, type ChartAxis, type ChartEl, type SlideElement, type SlideLayout, type Trendline } from "@/lib/slides/model";
import { NUMBER_FORMATS, TRENDLINE_TYPES } from "@/lib/slides/chart";
import { SHAPES, isLineShape, shapePath } from "@/lib/slides/shapes";
import { SWATCHES } from "@/lib/slides/themes";
import type { Align, Axis } from "@/lib/slides/selection";
import { cssPt, lineMultiple, safeHref } from "@/lib/slides/text";
import { CropForm, GradientForm, ShadowForm } from "./EffectForms";
import { gradientCss, validGradient, wordArtCss } from "@/lib/slides/effects";
import type { Gradient, MasterKey } from "@/lib/slides/model";
import { MODEL_VIEWS, type Turn } from "@/lib/slides/model3d";
import { WARPS } from "@/lib/slides/warp";
import { WORDART_PRESETS, type WordArt } from "@/lib/slides/model";

const PT_SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 54, 60, 72, 96];
const FONTS = ["Calibri", "Arial", "Helvetica", "Verdana", "Tahoma", "Trebuchet MS", "Segoe UI", "Inter", "Georgia", "Times New Roman", "Garamond", "Courier New", "Consolas", "Comic Sans MS", "Impact"];

// Toolbar buttons preventDefault on mousedown so clicking one never blurs the
// editor or collapses the selection before the command runs.
export function TB({ active, title, onClick, disabled, children, testId }: { active?: boolean; title: string; onClick: () => void; disabled?: boolean; children: ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-testid={testId}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`h-8 min-w-8 px-2 rounded-md text-sm flex items-center justify-center transition disabled:opacity-35 disabled:pointer-events-none ${active ? "bg-indigo-100 text-indigo-700" : "text-slate-600 hover:bg-slate-100"}`}
    >
      {children}
    </button>
  );
}

export function Popover({ label, title, children, testId, disabled, wide }: { label: ReactNode; title: string; children: (close: () => void) => ReactNode; testId?: string; disabled?: boolean; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        title={title}
        aria-label={title}
        data-testid={testId}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className={`h-8 px-2 rounded-md text-sm flex items-center gap-1 transition disabled:opacity-35 disabled:pointer-events-none ${open ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-100"}`}
      >
        {label}
        <span className="text-[9px] text-slate-400">▼</span>
      </button>
      {open && (
        <div className={`absolute left-0 top-9 z-50 rounded-lg border border-slate-200 bg-white shadow-lg p-2 ${wide ? "w-72" : "min-w-44"}`} onMouseDown={(e) => { if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) e.preventDefault(); }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function Swatches({ value, onPick, allowNone, noneLabel = "No fill" }: { value?: string | null; onPick: (hex: string | null) => void; allowNone?: boolean; noneLabel?: string }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-10 gap-1">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            title={`#${c}`}
            onClick={() => onPick(c)}
            className={`w-5 h-5 rounded border ${value === c ? "ring-2 ring-indigo-400" : "border-slate-300"}`}
            style={{ background: `#${c}` }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-600">
        {allowNone && (
          <button type="button" className="px-2 py-1 rounded hover:bg-slate-100 border border-slate-200" onClick={() => onPick(null)}>
            {noneLabel}
          </button>
        )}
        <label className="px-2 py-1 rounded hover:bg-slate-100 border border-slate-200 cursor-pointer">
          More colours…
          <input type="color" className="sr-only" value={`#${value || "4f46e5"}`} onChange={(e) => onPick(e.target.value.slice(1).toUpperCase())} />
        </label>
      </div>
    </div>
  );
}

export function ShapeIcon({ id, size = 22 }: { id: string; size?: number }) {
  const line = isLineShape(id);
  return (
    <svg width={size} height={size} viewBox={`-1 -1 ${size + 2} ${size + 2}`}>
      <path d={shapePath(id, size, line ? size * 0.6 : size * 0.8)} transform={line ? `translate(0 ${size * 0.2})` : `translate(0 ${size * 0.1})`} fill={line ? "none" : "#c7d2fe"} stroke="#4f46e5" strokeWidth={1.3} />
    </svg>
  );
}

function ptOf(fs: string | undefined): string {
  if (!fs) return "";
  const n = parseFloat(fs);
  if (!Number.isFinite(n)) return "";
  return String(/pt$/.test(fs) ? n : Math.round(n * 0.75));
}

export type ToolbarActions = {
  addSlide: (layout?: MasterKey) => void;
  setLayout: (l: MasterKey) => void;
  /** built-in and custom layouts to choose from, and the current slide's */
  layouts: { id: MasterKey; label: string; group?: string }[];
  layoutKey: MasterKey;
  insertText: () => void;
  insertImage: () => void;
  insertMedia: () => void;
  insertModel: () => void;
  /** turn the selected 3D model (degrees) */
  turnModel: (t: Partial<Turn>) => void;
  insertShape: (id: string) => void;
  insertTable: (rows: number, cols: number) => void;
  insertChart: (type: ChartEl["chartType"]) => void;
  setBg: (hex: string | null) => void;
  setBgGrad: (g: Gradient | null) => void;
  patchEl: (patch: Partial<SlideElement>) => void;
  arrange: (op: "front" | "back" | "forward" | "backward") => void;
  rotate: (op: "right" | "left" | "flipH" | "flipV") => void;
  align: (op: Align) => void;
  distribute: (axis: Axis) => void;
  group: () => void;
  ungroup: () => void;
  /** number of selected objects, and whether the selection holds a group */
  selCount: number;
  selGrouped: boolean;
  deleteEl: () => void;
  selectAllObjects: () => void;
  showFrom: (current: boolean) => void;
  toggleAnim: () => void;
  toggleDesigner: () => void;
  /** Edit Points on the selected shape (turned into a freeform) */
  editPoints: () => void;
  pointsOn: boolean;
  /** a SmartArt graphic is selected (its Text Pane can open) */
  diagramSel: boolean;
  editDiagram: () => void;
  /** pen tool: draw freeform shapes */
  pen: false | "free" | "poly";
  togglePen: (mode?: "free" | "poly") => void;
  /** format painter: on, and start it (sticky = stays on for several objects) */
  painter: boolean;
  startPainter: (sticky: boolean) => void;
  insertIcon: () => void;
  insertDiagram: () => void;
  insertMath: () => void;
};

function ChartSettings({ el, onPatch }: { el: ChartEl; onPatch: (patch: Partial<ChartEl>) => void }) {
  const table = () => [
    ["Category", ...el.series.map((s) => s.name)].join(","),
    ...el.categories.map((c, i) => [c, ...el.series.map((s) => String(s.values[i] ?? 0))].join(",")),
  ].join("\n");
  const [data, setData] = useState(table);
  useEffect(() => setData(table()), [el.id]);
  const applyData = () => {
    const rows = data.trim().split(/\r?\n/).map((line) => line.split(",").map((cell) => cell.trim()));
    if (rows.length < 2 || rows[0].length < 2 || rows.some((row) => row.length !== rows[0].length) || rows.length > 101 || rows[0].length > 21) {
      alert("Use a header row and up to 100 categories and 20 series, with the same number of comma-separated columns on every row.");
      return;
    }
    const numbers = rows.slice(1).map((row) => row.slice(1).map(Number));
    if (numbers.some((row) => row.some((n) => !Number.isFinite(n)))) {
      alert("Chart values must be numbers.");
      return;
    }
    onPatch({ categories: rows.slice(1).map((row) => row[0]), series: rows[0].slice(1).map((name, i) => ({ name: name || `Series ${i + 1}`, values: numbers.map((row) => row[i]), color: el.series[i]?.color, ...(el.series[i]?.trend ? { trend: el.series[i].trend } : {}), ...(el.series[i]?.type ? { type: el.series[i].type } : {}), ...(el.series[i]?.y2 ? { y2: true } : {}) })) });
  };
  return <div className="space-y-2 text-xs text-slate-700" data-testid="chart-settings" onKeyDown={(e) => e.stopPropagation()}>
    <label className="block">Chart title<input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={el.title || ""} onChange={(e) => onPatch({ title: e.target.value })} /></label>
    <label className="block">Type<select className="mt-1 w-full rounded border border-slate-300 px-2 py-1" data-testid="chart-type" value={el.chartType} onChange={(e) => onPatch({ chartType: e.target.value as ChartEl["chartType"] })}>{CHART_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
    {el.chartType === "bar" && (
      <label className="block">Direction<select className="mt-1 w-full rounded border border-slate-300 px-2 py-1" data-testid="chart-dir" value={el.barDir || "col"} onChange={(e) => onPatch({ barDir: e.target.value === "bar" ? "bar" : undefined })}><option value="col">Vertical columns</option><option value="bar">Horizontal bars</option></select></label>
    )}
    {(el.chartType === "bar" || el.chartType === "area" || el.chartType === "line") && (
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2"><input type="checkbox" data-testid="chart-stacked" checked={!!el.stacked} onChange={(e) => onPatch({ stacked: e.target.checked || undefined, ...(e.target.checked ? {} : { percent: undefined }) })} />Stacked</label>
        <label className="flex items-center gap-2"><input type="checkbox" data-testid="chart-percent" checked={!!el.percent && !!el.stacked} onChange={(e) => onPatch({ percent: e.target.checked || undefined, ...(e.target.checked ? { stacked: true } : {}) })} />100%</label>
      </div>
    )}
    {(el.chartType === "bar" || el.chartType === "area" || el.chartType === "line") && el.series.length > 1 && (
      <details className="rounded border border-slate-200 p-2" data-testid="chart-combo" open={isCombo(el)}>
        <summary className="cursor-pointer font-medium">Combo: type and axis per series</summary>
        <div className="mt-1 space-y-1">
          {el.series.map((x, k) => (
            <div key={k} className="flex items-center gap-1">
              <span className="w-20 truncate" title={x.name}>{x.name}</span>
              <select className="min-w-0 flex-1 rounded border border-slate-300 px-1 py-0.5" data-testid={`chart-series-type-${k}`} value={x.type || el.chartType} onChange={(e) => onPatch({ series: el.series.map((y, j) => (j === k ? { ...y, type: e.target.value === el.chartType ? undefined : (e.target.value as "bar" | "line" | "area") } : y)) })}>
                <option value="bar">Column</option><option value="line">Line</option><option value="area">Area</option>
              </select>
              <label className="flex items-center gap-1 whitespace-nowrap" title="Plot on the secondary value axis"><input type="checkbox" data-testid={`chart-series-y2-${k}`} checked={!!x.y2} onChange={(e) => onPatch({ series: el.series.map((y, j) => (j === k ? { ...y, y2: e.target.checked || undefined } : y)) })} />2nd axis</label>
            </div>
          ))}
        </div>
      </details>
    )}
    <label className="flex items-center gap-2"><input type="checkbox" data-testid="chart-labels" checked={!!el.dataLabels} onChange={(e) => onPatch({ dataLabels: e.target.checked || undefined })} />Data labels</label>
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-2"><input type="checkbox" checked={el.showLegend !== false} onChange={(e) => onPatch({ showLegend: e.target.checked })} />Legend</label>
      {el.showLegend !== false && (
        <select className="ml-auto rounded border border-slate-300 px-1 py-0.5" data-testid="chart-legend-pos" value={el.legendPos || "b"} onChange={(e) => onPatch({ legendPos: e.target.value as ChartEl["legendPos"] })}>
          <option value="b">Bottom</option><option value="t">Top</option><option value="r">Right</option><option value="l">Left</option>
        </select>
      )}
    </div>
    {el.chartType !== "pie" && el.chartType !== "doughnut" && <ChartAxesForm el={el} onPatch={onPatch} />}
    <label className="block">{el.chartType === "scatter" ? "Data (X value, then one column of Y values per series)" : "Data (category, then one column per series)"}<textarea className="mt-1 w-full h-32 rounded border border-slate-300 px-2 py-1 font-mono text-xs" value={data} onChange={(e) => setData(e.target.value)} data-testid="chart-data" /></label>
    <button type="button" className="rounded bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700" onClick={applyData} data-testid="chart-apply">Apply data</button>
  </div>;
}

const numOrUndef = (v: string) => (v.trim() === "" ? undefined : Number.isFinite(Number(v)) ? Number(v) : null);

/** Value/category axis bounds, units, number format, gridlines and titles, plus a trendline per series. */
function ChartAxesForm({ el, onPatch }: { el: ChartEl; onPatch: (patch: Partial<ChartEl>) => void }) {
  const val = el.valAx || {};
  const cat = el.catAx || {};
  const scatter = el.chartType === "scatter";
  const tidy = (a: ChartAxis) => {
    const out = Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined && v !== "")) as ChartAxis;
    return Object.keys(out).length ? out : undefined;
  };
  const setVal = (p: Partial<ChartAxis>) => onPatch({ valAx: tidy({ ...val, ...p }) });
  const setCat = (p: Partial<ChartAxis>) => onPatch({ catAx: tidy({ ...cat, ...p }) });
  const [si, setSi] = useState(0);
  const s = el.series[Math.min(si, el.series.length - 1)];
  const setTrend = (t: Trendline | undefined) => onPatch({ series: el.series.map((x, k) => (x === s ? { ...x, trend: t } : x)) });
  const numField = (label: string, id: string, v: number | undefined, set: (n: number | undefined) => void) => (
    <label className="flex items-center gap-1">
      <span className="w-12 shrink-0">{label}</span>
      <input
        key={`${el.id}-${id}-${v ?? ""}`}
        className="w-full min-w-0 rounded border border-slate-300 px-1 py-0.5"
        data-testid={id}
        placeholder="Auto"
        defaultValue={v ?? ""}
        onBlur={(e) => { const n = numOrUndef(e.target.value); if (n !== null && n !== v) set(n); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
    </label>
  );
  const fmtSelect = (id: string, v: string | undefined, set: (f: string | undefined) => void) => (
    <label className="flex items-center gap-1">
      <span className="w-12 shrink-0">Format</span>
      <select className="w-full min-w-0 rounded border border-slate-300 px-1 py-0.5" data-testid={id} value={NUMBER_FORMATS.some((f) => f.code === (v || "General")) ? v || "General" : "custom"} onChange={(e) => {
        if (e.target.value === "custom") set(window.prompt("Number format code (Excel style, e.g. 0.0\"k\")", v || "0") || v);
        else set(e.target.value === "General" ? undefined : e.target.value);
      }}>
        {NUMBER_FORMATS.map((f) => <option key={f.code} value={f.code}>{f.label}</option>)}
        <option value="custom">{v && !NUMBER_FORMATS.some((f) => f.code === v) ? `Custom (${v})` : "Custom…"}</option>
      </select>
    </label>
  );
  return (
    <details className="rounded border border-slate-200 p-2" data-testid="chart-axes" open={!!(el.valAx || el.catAx || el.series.some((x) => x.trend))}>
      <summary className="cursor-pointer font-medium">Axes &amp; trendline</summary>
      <div className="mt-2 space-y-1.5">
        <div className="text-[11px] uppercase tracking-wide text-slate-400">Value axis</div>
        <div className="grid grid-cols-2 gap-1.5">
          {numField("Min", "chart-val-min", val.min, (n) => setVal({ min: n }))}
          {numField("Max", "chart-val-max", val.max, (n) => setVal({ max: n }))}
          {numField("Major", "chart-val-major", val.major, (n) => setVal({ major: n && n > 0 ? n : undefined }))}
          {numField("Minor", "chart-val-minor", val.minor, (n) => setVal({ minor: n && n > 0 ? n : undefined }))}
        </div>
        {fmtSelect("chart-val-fmt", val.fmt, (f) => setVal({ fmt: f }))}
        <div className="flex gap-3">
          <label className="flex items-center gap-1"><input type="checkbox" data-testid="chart-val-grid" checked={val.grid !== false} onChange={(e) => setVal({ grid: e.target.checked ? undefined : false })} />Major gridlines</label>
          <label className="flex items-center gap-1"><input type="checkbox" data-testid="chart-val-minor-grid" checked={!!val.minorGrid} onChange={(e) => setVal({ minorGrid: e.target.checked || undefined })} />Minor</label>
        </div>
        <label className="flex items-center gap-1"><span className="w-12 shrink-0">Title</span><input key={`${el.id}-vt`} className="w-full min-w-0 rounded border border-slate-300 px-1 py-0.5" data-testid="chart-val-title" defaultValue={val.title || ""} onBlur={(e) => e.target.value !== (val.title || "") && setVal({ title: e.target.value || undefined })} /></label>
        <div className="text-[11px] uppercase tracking-wide text-slate-400 pt-1">{scatter ? "X axis" : "Category axis"}</div>
        {scatter && (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              {numField("Min", "chart-cat-min", cat.min, (n) => setCat({ min: n }))}
              {numField("Max", "chart-cat-max", cat.max, (n) => setCat({ max: n }))}
              {numField("Major", "chart-cat-major", cat.major, (n) => setCat({ major: n && n > 0 ? n : undefined }))}
            </div>
            {fmtSelect("chart-cat-fmt", cat.fmt, (f) => setCat({ fmt: f }))}
          </>
        )}
        <label className="flex items-center gap-1"><input type="checkbox" data-testid="chart-cat-grid" checked={!!cat.grid} onChange={(e) => setCat({ grid: e.target.checked || undefined })} />Gridlines</label>
        <label className="flex items-center gap-1"><span className="w-12 shrink-0">Title</span><input key={`${el.id}-ct`} className="w-full min-w-0 rounded border border-slate-300 px-1 py-0.5" data-testid="chart-cat-title" defaultValue={cat.title || ""} onBlur={(e) => e.target.value !== (cat.title || "") && setCat({ title: e.target.value || undefined })} /></label>
        {s && (
          <>
            <div className="text-[11px] uppercase tracking-wide text-slate-400 pt-1">Trendline</div>
            <div className="flex gap-1">
              <select className="w-1/2 min-w-0 rounded border border-slate-300 px-1 py-0.5" data-testid="chart-trend-series" value={el.series.indexOf(s)} onChange={(e) => setSi(Number(e.target.value))}>
                {el.series.map((x, k) => <option key={k} value={k}>{x.name}</option>)}
              </select>
              <select className="w-1/2 min-w-0 rounded border border-slate-300 px-1 py-0.5" data-testid="chart-trend-type" value={s.trend?.type || ""} onChange={(e) => setTrend(e.target.value ? { ...(s.trend || {}), type: e.target.value as Trendline["type"] } : undefined)}>
                <option value="">None</option>
                {TRENDLINE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            {s.trend?.type === "poly" && (
              <label className="flex items-center gap-1">Order<input type="number" min={2} max={6} className="w-16 rounded border border-slate-300 px-1 py-0.5" data-testid="chart-trend-order" value={s.trend.order || 2} onChange={(e) => setTrend({ ...s.trend!, order: Math.max(2, Math.min(6, Number(e.target.value) || 2)) })} /></label>
            )}
            {s.trend?.type === "movingAvg" && (
              <label className="flex items-center gap-1">Period<input type="number" min={2} max={255} className="w-16 rounded border border-slate-300 px-1 py-0.5" data-testid="chart-trend-period" value={s.trend.period || 2} onChange={(e) => setTrend({ ...s.trend!, period: Math.max(2, Math.min(255, Number(e.target.value) || 2)) })} /></label>
            )}
            {s.trend && s.trend.type !== "movingAvg" && (
              <div className="flex gap-3">
                <label className="flex items-center gap-1"><input type="checkbox" data-testid="chart-trend-eq" checked={!!s.trend.eq} onChange={(e) => setTrend({ ...s.trend!, eq: e.target.checked || undefined })} />Equation</label>
                <label className="flex items-center gap-1"><input type="checkbox" data-testid="chart-trend-r2" checked={!!s.trend.r2} onChange={(e) => setTrend({ ...s.trend!, r2: e.target.checked || undefined })} />R²</label>
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
}

/** Insert, change or remove the hyperlink on the selected text. */
function LinkForm({ editor, close }: { editor: Editor; close: () => void }) {
  const [url, setUrl] = useState((editor.getAttributes("link").href as string) || "");
  const apply = () => {
    const href = safeHref(url) || (url && !/^[a-z]+:/i.test(url) ? safeHref(`https://${url}`) : "");
    if (!href) return;
    // take the focus back from the address field now, not on the next frame, so
    // keys pressed right after Apply land in the text
    editor.view.focus();
    const chain = editor.chain().focus().extendMarkRange("link");
    // with nothing selected, insert the address itself as the link text
    if (editor.state.selection.empty && !editor.isActive("link")) chain.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
    else chain.setLink({ href }).run();
    close();
  };
  return (
    <form className="flex flex-col gap-2 text-sm w-64" onSubmit={(e) => { e.preventDefault(); apply(); }} onKeyDown={(e) => e.stopPropagation()}>
      <input autoFocus data-testid="link-url" className="h-8 rounded border border-slate-300 px-2" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
      <div className="flex gap-2">
        <button type="submit" data-testid="link-apply" className="rounded bg-indigo-600 px-3 py-1 text-white hover:bg-indigo-700">Apply</button>
        {editor.isActive("link") && <button type="button" className="rounded px-3 py-1 hover:bg-slate-100" onClick={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); close(); }}>Remove link</button>}
      </div>
    </form>
  );
}

const LINE_CHOICES = [1, 1.15, 1.5, 2, 2.5, 3];

/** PowerPoint's line spacing menu plus space before/after the paragraph. */
function SpacingForm({ editor, close }: { editor: Editor; close: () => void }) {
  const p = editor.getAttributes("paragraph");
  const cur = lineMultiple(p.lineHeight as string | undefined) ?? 1;
  const [before, setBefore] = useState(String(cssPt(p.spaceBefore as string | undefined) ?? 0));
  const [after, setAfter] = useState(String(cssPt(p.spaceAfter as string | undefined) ?? 0));
  const pts = (v: string) => Math.max(0, Math.min(200, Number(v) || 0)) || null;
  return (
    <div className="flex flex-col text-sm w-48" onKeyDown={(e) => e.stopPropagation()}>
      {LINE_CHOICES.map((m) => (
        <button key={m} type="button" data-testid={`line-${m}`} className={`text-left px-2 py-1.5 rounded hover:bg-slate-50 ${Math.abs(cur - m) < 0.01 ? "text-indigo-700 font-medium" : ""}`} onClick={() => { editor.chain().focus().setLineSpacing(m === 1 ? null : m).run(); close(); }}>
          {Math.abs(cur - m) < 0.01 ? "✓ " : ""}{m.toFixed(m === 1.15 ? 2 : 1)}
        </button>
      ))}
      <div className="h-px bg-slate-100 my-1" />
      <label className="flex items-center gap-2 px-2 py-1 text-xs text-slate-600">Before (pt)<input data-testid="space-before" type="number" min={0} className="ml-auto w-16 h-7 rounded border border-slate-300 px-1" value={before} onChange={(e) => setBefore(e.target.value)} /></label>
      <label className="flex items-center gap-2 px-2 py-1 text-xs text-slate-600">After (pt)<input data-testid="space-after" type="number" min={0} className="ml-auto w-16 h-7 rounded border border-slate-300 px-1" value={after} onChange={(e) => setAfter(e.target.value)} /></label>
      <button type="button" data-testid="space-apply" className="mx-2 mt-1 rounded bg-indigo-600 px-3 py-1 text-white hover:bg-indigo-700" onClick={() => { editor.chain().focus().setParagraphSpacing(pts(before), pts(after)).run(); close(); }}>Apply spacing</button>
    </div>
  );
}

export default function SlideToolbar({
  editor,
  el,
  layout,
  bg,
  bgGrad,
  a,
  tableTools,
}: {
  editor: Editor | null;
  el: SlideElement | null;
  layout: SlideLayout;
  bg: string;
  bgGrad?: Gradient;
  a: ToolbarActions;
  /** the table tools, shown while a table is selected */
  tableTools?: ReactNode;
}) {
  // re-render on selection/formatting changes of the active editor
  const [, force] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const f = () => force((n) => n + 1);
    editor.on("selectionUpdate", f);
    editor.on("transaction", f);
    return () => {
      editor.off("selectionUpdate", f);
      editor.off("transaction", f);
    };
  }, [editor]);

  const Sep = () => <span className="w-px h-5 bg-slate-200 mx-0.5" />;
  const ts = editor?.getAttributes("textStyle") || {};
  const curSize = ptOf(ts.fontSize as string | undefined);
  const curColor = (ts.color as string) || "#1f2430";
  const curFont = ((ts.fontFamily as string) || "").replace(/['"]/g, "").split(",")[0];
  const selectCls = "h-8 rounded-md text-sm text-slate-700 bg-white border border-slate-200 px-1.5 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-40";
  const ed = editor;
  const shapeSel = el?.type === "shape" ? el : null;

  return (
    <div className="bg-white border-b border-slate-200 px-3 py-1.5 flex flex-wrap items-center gap-1" data-testid="slide-toolbar">
      <TB title="Undo" disabled={!ed} onClick={() => ed?.chain().focus().undo().run()}>↺</TB>
      <TB title="Redo" disabled={!ed} onClick={() => ed?.chain().focus().redo().run()}>↻</TB>
      <Sep />
      <Popover label={<span>＋ Slide</span>} title="New slide" testId="tb-new-slide">
        {(close) => (
          <div className="flex flex-col">
            {a.layouts.map((l) => (
              <button key={l.id} type="button" data-testid={`new-slide-${l.id}`} className="text-left text-sm px-2 py-1.5 rounded hover:bg-slate-50" onClick={() => { a.addSlide(l.id); close(); }}>
                {l.group ? <span className="text-slate-400">{l.group} · </span> : null}{l.label}
              </button>
            ))}
          </div>
        )}
      </Popover>
      <Popover label={<span>Layout</span>} title="Slide layout" testId="tb-layout">
        {(close) => (
          <div className="flex flex-col">
            {a.layouts.map((l) => (
              <button key={l.id} type="button" data-testid={`layout-${l.id}`} className={`text-left text-sm px-2 py-1.5 rounded hover:bg-slate-50 ${l.id === a.layoutKey ? "text-indigo-700 font-medium" : ""}`} onClick={() => { a.setLayout(l.id); close(); }}>
                {l.id === a.layoutKey ? "✓ " : ""}{l.group ? <span className="text-slate-400">{l.group} · </span> : null}{l.label}
              </button>
            ))}
          </div>
        )}
      </Popover>
      <Sep />
      <select
        className={`${selectCls} w-32`}
        title="Font"
        disabled={!ed}
        value={curFont}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => (e.target.value ? ed?.chain().focus().setFontFamily(e.target.value).run() : ed?.chain().focus().unsetFontFamily().run())}
      >
        <option value="">Theme font</option>
        {curFont && !FONTS.includes(curFont) && <option value={curFont}>{curFont}</option>}
        {FONTS.map((f) => (
          <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
        ))}
      </select>
      <select
        className={selectCls}
        title="Font size (pt)"
        disabled={!ed}
        value={curSize}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => (e.target.value ? ed?.chain().focus().setFontSize(`${e.target.value}pt`).run() : ed?.chain().focus().unsetFontSize().run())}
      >
        <option value="">Auto</option>
        {curSize && !PT_SIZES.includes(Number(curSize)) && <option value={curSize}>{curSize}</option>}
        {PT_SIZES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <TB title="Bold" disabled={!ed} active={ed?.isActive("bold")} onClick={() => ed?.chain().focus().toggleBold().run()}><b>B</b></TB>
      <TB title="Italic" disabled={!ed} active={ed?.isActive("italic")} onClick={() => ed?.chain().focus().toggleItalic().run()}><i>I</i></TB>
      <TB title="Underline" disabled={!ed} active={ed?.isActive("underline")} onClick={() => ed?.chain().focus().toggleUnderline().run()}><u>U</u></TB>
      {!el && <TB title="Format painter: copy the selected text's format, then select the text to paint" testId="tb-text-painter" disabled={!ed} active={a.painter} onClick={() => a.startPainter(false)}>🖌</TB>}
      <TB title="Strikethrough" disabled={!ed} active={ed?.isActive("strike")} onClick={() => ed?.chain().focus().toggleStrike().run()}><s>S</s></TB>
      <label className={`h-8 w-8 rounded-md hover:bg-slate-100 flex flex-col items-center justify-center cursor-pointer ${ed ? "" : "opacity-35 pointer-events-none"}`} title="Text color" onMouseDown={(e) => e.preventDefault()}>
        <span className="text-[13px] leading-none font-semibold" style={{ color: curColor }}>A</span>
        <span className="w-4 h-[3px] rounded-sm" style={{ background: curColor }} />
        <input type="color" value={curColor.length === 7 ? curColor : "#1f2430"} className="sr-only" onChange={(e) => ed?.chain().focus().setColor(e.target.value).run()} />
      </label>
      <Popover label={<span className="px-0.5 rounded-sm" style={{ background: (ed?.getAttributes("highlight").color as string) || "#fff200" }}>ab</span>} title="Highlight" testId="tb-highlight" disabled={!ed}>
        {(close) => <Swatches value={null} allowNone noneLabel="No highlight" onPick={(c) => { if (c) ed?.chain().focus().setHighlight({ color: `#${c}` }).run(); else ed?.chain().focus().unsetHighlight().run(); close(); }} />}
      </Popover>
      <TB title="Subscript (Ctrl+=)" testId="tb-sub" disabled={!ed} active={ed?.isActive("subscript")} onClick={() => ed?.chain().focus().toggleSubscript().run()}>x<sub>2</sub></TB>
      <TB title="Superscript (Ctrl+Shift+=)" testId="tb-sup" disabled={!ed} active={ed?.isActive("superscript")} onClick={() => ed?.chain().focus().toggleSuperscript().run()}>x<sup>2</sup></TB>
      <Popover label={<span>🔗</span>} title="Link" testId="tb-link" disabled={!ed}>
        {(close) => <LinkForm editor={ed!} close={close} />}
      </Popover>
      <Sep />
      <TB title="Bulleted list" disabled={!ed} active={ed?.isActive("bulletList")} onClick={() => ed?.chain().focus().toggleBulletList().run()}>•</TB>
      <TB title="Numbered list" disabled={!ed} active={ed?.isActive("orderedList")} onClick={() => ed?.chain().focus().toggleOrderedList().run()}>1.</TB>
      <TB title="Decrease list level" disabled={!ed || !ed.can().liftListItem("listItem")} onClick={() => ed?.chain().focus().liftListItem("listItem").run()}>⇤</TB>
      <TB title="Increase list level" disabled={!ed || !ed.can().sinkListItem("listItem")} onClick={() => ed?.chain().focus().sinkListItem("listItem").run()}>⇥</TB>
      <TB title="Align left" disabled={!ed} active={ed?.isActive({ textAlign: "left" })} onClick={() => ed?.chain().focus().setTextAlign("left").run()}>⯇</TB>
      <TB title="Center" disabled={!ed} active={ed?.isActive({ textAlign: "center" })} onClick={() => ed?.chain().focus().setTextAlign("center").run()}>≡</TB>
      <TB title="Align right" disabled={!ed} active={ed?.isActive({ textAlign: "right" })} onClick={() => ed?.chain().focus().setTextAlign("right").run()}>⯈</TB>
      <TB title="Justify" disabled={!ed} active={ed?.isActive({ textAlign: "justify" })} onClick={() => ed?.chain().focus().setTextAlign("justify").run()}>☰</TB>
      <Popover label={<span>↕</span>} title="Line and paragraph spacing" testId="tb-spacing" disabled={!ed}>
        {(close) => <SpacingForm editor={ed!} close={close} />}
      </Popover>
      <Sep />
      <TB title="Text box" testId="tb-textbox" onClick={a.insertText}>𝐓 Text box</TB>
      <TB title="Picture" testId="tb-image" onClick={a.insertImage}>🖼 Picture</TB>
      <TB title="Video or audio" testId="tb-media" onClick={a.insertMedia}>🎬 Media</TB>
      <TB title="3D model (.glb or .gltf)" testId="tb-model3d" onClick={a.insertModel}>🧊 3D model</TB>
      <Popover label={<span>◇ Shapes</span>} title="Shapes" testId="tb-shapes" wide>
        {(close) => (
          <div className="grid grid-cols-8 gap-1">
            {SHAPES.map((s) => (
              <button key={s.id} type="button" title={s.label} data-testid={`shape-${s.id}`} className="w-8 h-8 rounded hover:bg-slate-100 flex items-center justify-center" onClick={() => { a.insertShape(s.id); close(); }}>
                <ShapeIcon id={s.id} />
              </button>
            ))}
          </div>
        )}
      </Popover>
      <TB title="Freeform: Scribble — draw a freehand shape (Esc to stop)" testId="tb-pen" active={a.pen === "free"} onClick={() => a.togglePen("free")}>✎ Draw</TB>
      <TB title="Freeform: Shape — click each corner; click the first corner to close, double-click or Enter to finish open" testId="tb-pen-poly" active={a.pen === "poly"} onClick={() => a.togglePen("poly")}>⬠ Polygon</TB>
      <TB title="Icon" testId="tb-icon" onClick={a.insertIcon}>☆ Icon</TB>
      <TB title="SmartArt graphic" testId="tb-smartart" onClick={a.insertDiagram}>⧉ SmartArt</TB>
      <TB title="Equation" testId="tb-math" onClick={a.insertMath}>∑ Equation</TB>
      <Popover label={<span>▦ Table</span>} title="Table" testId="tb-table">
        {(close) => <TableGrid onPick={(r, c) => { a.insertTable(r, c); close(); }} />}
      </Popover>
      <Popover label={<span>▥ Chart</span>} title="Chart" testId="tb-chart">
        {(close) => <div className="flex flex-col text-sm">{CHART_TYPES.map((t) => <button key={t.id} type="button" data-testid={`chart-insert-${t.id}`} className="text-left px-2 py-1.5 rounded hover:bg-slate-50" onClick={() => { a.insertChart(t.id); close(); }}>{t.label.replace(/ \(.*\)$/, "")}</button>)}</div>}
      </Popover>
      <Popover label={<span>Background</span>} title="Slide background" testId="tb-bg">
        {(close) => (
          <div className="space-y-3">
            <Swatches value={bg} allowNone noneLabel="Reset" onPick={(c) => { a.setBg(c); close(); }} />
            <div className="border-t border-slate-100 pt-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-1">Gradient</div>
              <GradientForm value={bgGrad} base={bg} onApply={(g) => { a.setBgGrad(g); close(); }} />
            </div>
          </div>
        )}
      </Popover>
      {el && (
        <>
          <Sep />
          {shapeSel && !isLineShape(shapeSel.shape) && (
            <Popover label={<span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm border border-slate-300" style={{ background: validGradient(shapeSel.grad) ? gradientCss(shapeSel.grad) : shapeSel.fill ? `#${shapeSel.fill}` : "transparent" }} />Fill</span>} title="Shape fill" testId="tb-fill">
              {(close) => (
                <div className="space-y-3">
                  <Swatches value={shapeSel.grad ? undefined : shapeSel.fill} allowNone onPick={(c) => { a.patchEl({ fill: c, grad: undefined }); close(); }} />
                  <div className="border-t border-slate-100 pt-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-1">Gradient</div>
                    <GradientForm value={shapeSel.grad} base={shapeSel.fill} onApply={(g) => { a.patchEl(g ? { grad: g, fill: g.stops[0].color } : { grad: undefined }); close(); }} />
                  </div>
                  <label className="flex items-center gap-2 border-t border-slate-100 pt-2 text-xs text-slate-600">Transparency
                    <input type="range" min={0} max={100} step={5} className="flex-1" data-testid="fill-transparency" disabled={!shapeSel.fill && !shapeSel.grad} value={Math.round((1 - (shapeSel.fillA ?? 1)) * 100)} onChange={(e) => { const t = Number(e.target.value); a.patchEl({ fillA: t > 0 ? Math.round((100 - t)) / 100 : undefined }); }} />
                    <span className="w-9 text-right tabular-nums">{Math.round((1 - (shapeSel.fillA ?? 1)) * 100)}%</span>
                  </label>
                </div>
              )}
            </Popover>
          )}
          {shapeSel && (
            <Popover label={<span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm border-2" style={{ borderColor: shapeSel.line ? `#${shapeSel.line}` : "transparent" }} />Outline</span>} title="Shape outline" testId="tb-outline">
              {(close) => (
                <div className="space-y-2">
                  <Swatches value={shapeSel.line} allowNone noneLabel="No outline" onPick={(c) => { a.patchEl({ line: c }); close(); }} />
                  <div className="flex items-center gap-1 text-xs text-slate-600">
                    Weight
                    {[0.75, 1.5, 2.25, 3, 4.5, 6].map((pt) => (
                      <button key={pt} type="button" className="px-1.5 py-0.5 rounded border border-slate-200 hover:bg-slate-50" onClick={() => a.patchEl({ lineW: Math.round((pt / 0.75) * 100) / 100, line: shapeSel.line || "000000" })}>
                        {pt}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Popover>
          )}
          {a.diagramSel && (
            <TB title="Text Pane: edit the SmartArt graphic's outline; the diagram is laid out again" testId="tb-smartart-text" onClick={a.editDiagram}>☰ Text Pane</TB>
          )}
          {shapeSel && shapeSel.shape !== "line" && shapeSel.shape !== "lineArrow" && (
            <TB title="Edit points: drag the outline's points; double-click a point to delete it, or the outline to add one" testId="tb-edit-points" active={a.pointsOn} onClick={a.editPoints}>⌖ Edit points</TB>
          )}
          {(el.type === "text" || shapeSel) && (
            <Popover label={<span className="font-bold italic" style={{ WebkitTextStroke: "0.5px #4f46e5" }}>A</span>} title="WordArt text effects" testId="tb-wordart">
              {(close) => {
                const cur = (el as { wa?: WordArt }).wa;
                const warp = (el as { warp?: string }).warp;
                return (
                  <div className="w-72 space-y-2">
                  <div className="grid grid-cols-2 gap-1.5">
                    {WORDART_PRESETS.map((p) => (
                      <button key={p.id} type="button" data-testid={`wordart-${p.id}`} title={p.label} className={`h-12 rounded border text-xl font-bold flex items-center justify-center ${JSON.stringify(cur || null) === JSON.stringify(p.wa) ? "border-indigo-500 ring-2 ring-indigo-100" : "border-slate-200 hover:bg-slate-50"}`} onClick={() => { a.patchEl({ wa: p.wa || undefined } as Partial<SlideElement>); close(); }}>
                        <span style={{ color: "#1f2430", ...(p.wa ? wordArtCss(p.wa) : {}) }}>{p.id === "none" ? "Aa" : "Abc"}</span>
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-slate-100 pt-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-1">Transform</div>
                    <div className="grid grid-cols-5 gap-1">
                      <button type="button" data-testid="warp-none" title="No transform" className={`h-9 rounded border text-[10px] ${!warp ? "border-indigo-500 ring-2 ring-indigo-100" : "border-slate-200 hover:bg-slate-50"}`} onClick={() => { a.patchEl({ warp: undefined } as Partial<SlideElement>); close(); }}>abc</button>
                      {WARPS.map((w) => (
                        <button key={w.id} type="button" data-testid={`warp-${w.id}`} title={w.label} className={`h-9 rounded border flex items-center justify-center ${warp === w.id ? "border-indigo-500 ring-2 ring-indigo-100" : "border-slate-200 hover:bg-slate-50"}`} onClick={() => { a.patchEl({ warp: w.id } as Partial<SlideElement>); close(); }}>
                          {w.path ? (
                            <svg width={44} height={26} viewBox="0 0 44 26"><path d={w.path(44, 26)} fill="none" stroke="#4f46e5" strokeWidth={2} /></svg>
                          ) : (
                            <span className="text-[11px] font-bold text-indigo-600" style={{ transform: w.css, display: "inline-block" }}>abc</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                  </div>
                );
              }}
            </Popover>
          )}
          {(el.type === "text" || shapeSel) && (
            <Popover label={<span>Columns</span>} title="Text columns" testId="tb-columns">
              {() => {
                const c = el as { cols?: number; colGap?: number };
                return (
                  <div className="space-y-2 text-sm text-slate-700 w-48">
                    <div className="flex gap-1">
                      {[1, 2, 3].map((n) => (
                        <button key={n} type="button" data-testid={`cols-${n}`} className={`flex-1 rounded border px-2 py-1 ${(c.cols || 1) === n ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"}`} onClick={() => a.patchEl({ cols: n > 1 ? n : undefined, colGap: n > 1 ? c.colGap ?? 24 : undefined } as Partial<SlideElement>)}>
                          {n}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-2">Spacing
                      <input type="number" min={0} max={200} disabled={(c.cols || 1) < 2} className="w-16 h-7 rounded border border-slate-300 px-1" value={c.colGap ?? 24} onChange={(e) => a.patchEl({ colGap: Math.max(0, Math.min(200, Number(e.target.value) || 0)) } as Partial<SlideElement>)} data-testid="cols-gap" />px
                    </label>
                  </div>
                );
              }}
            </Popover>
          )}
          {(shapeSel || el.type === "image") && (
            <Popover label={<span>Shadow</span>} title="Shadow" testId="tb-shadow">
              {(close) => <ShadowForm value={(el as { shadow?: import("@/lib/slides/model").Shadow }).shadow} onApply={(sh) => { a.patchEl({ shadow: sh || undefined } as Partial<SlideElement>); close(); }} />}
            </Popover>
          )}
          {el.type === "media" && (
            <Popover label={<span>Playback</span>} title="Playback" testId="tb-playback">
              {() => (
                <div className="space-y-1.5 text-sm text-slate-700 w-52">
                  <label className="flex items-center gap-2"><input type="checkbox" data-testid="media-autoplay" checked={!!el.autoplay} onChange={(e) => a.patchEl({ autoplay: e.target.checked || undefined } as Partial<SlideElement>)} />Start automatically</label>
                  <label className="flex items-center gap-2"><input type="checkbox" data-testid="media-loop" checked={!!el.loop} onChange={(e) => a.patchEl({ loop: e.target.checked || undefined } as Partial<SlideElement>)} />Loop until stopped</label>
                  <div className="text-xs text-slate-400">Plays in the slide show; without “Start automatically” use its play button.</div>
                </div>
              )}
            </Popover>
          )}
          {el.type === "model3d" && (
            <Popover label={<span>3D views</span>} title="3D model views" testId="tb-model-views" wide>
              {(close) => (
                <div className="space-y-2 text-sm text-slate-700 w-80">
                  <div className="grid grid-cols-3 gap-1">
                    {MODEL_VIEWS.map((v) => (
                      <button key={v.id} type="button" data-testid={`model-view-${v.id}`} className="rounded border border-slate-200 px-1.5 py-1 text-xs hover:bg-slate-50" onClick={() => { a.turnModel(v.turn); close(); }}>{v.label}</button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-600 border-t border-slate-100 pt-2">
                    {(["rx", "ry", "rz"] as const).map((k) => (
                      <label key={k} className="flex items-center gap-1">{k === "rx" ? "Tilt" : k === "ry" ? "Turn" : "Roll"}
                        <input type="number" step={5} className="w-16 h-7 rounded border border-slate-300 px-1" data-testid={`model-${k}`} value={el[k] || 0} onChange={(e) => a.turnModel({ [k]: Number(e.target.value) || 0 })} />°
                      </label>
                    ))}
                  </div>
                  <div className="text-xs text-slate-400">Or drag the round handle in the middle of the model.</div>
                </div>
              )}
            </Popover>
          )}
          {el.type === "zoom" && (
            <Popover label={<span>Zoom</span>} title="Zoom options" testId="tb-zoom">
              {() => (
                <div className="space-y-1.5 text-sm text-slate-700 w-56">
                  <div className="text-xs text-slate-500">{el.kind === "section" ? "Section zoom" : "Slide zoom"}</div>
                  <label className="flex items-center gap-2"><input type="checkbox" data-testid="zoom-return" checked={!!el.ret} onChange={(e) => a.patchEl({ ret: e.target.checked || undefined } as Partial<SlideElement>)} />Return to zoom</label>
                  <label className="flex items-center gap-2"><input type="checkbox" data-testid="zoom-border" checked={el.border !== false} onChange={(e) => a.patchEl({ border: e.target.checked ? undefined : false } as Partial<SlideElement>)} />Zoom border</label>
                  <div className="text-xs text-slate-400">In the slide show, click the zoom to present {el.kind === "section" ? "its section" : "its slide"}{el.ret ? " and come back here" : ""}.</div>
                </div>
              )}
            </Popover>
          )}
          {el.type === "image" && (
            <Popover label={<span>Crop</span>} title="Crop picture" testId="tb-crop">
              {(close) => <CropForm value={el.crop} onApply={(c) => { a.patchEl({ crop: c || undefined } as Partial<SlideElement>); close(); }} />}
            </Popover>
          )}
          {el.type === "table" && tableTools}
          {el.type === "chart" && <Popover label={<span>Edit chart</span>} title="Edit chart" testId="tb-chart-edit" wide>{() => <ChartSettings el={el} onPatch={a.patchEl} />}</Popover>}
          <button
            type="button"
            title="Format painter: click to paint once, double-click to keep painting (Esc to stop)"
            aria-label="Format painter"
            data-testid="tb-painter"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => { if (e.detail < 2) a.startPainter(false); }}
            onDoubleClick={() => a.startPainter(true)}
            className={`h-8 px-2 rounded-md text-sm transition ${a.painter ? "bg-indigo-100 text-indigo-700" : "text-slate-600 hover:bg-slate-100"}`}
          >
            🖌
          </button>
          <Popover label={<span>Alt text</span>} title="Alternative text for screen readers" testId="tb-alt">
            {(close) => <AltTextForm key={el.id} alt={el.alt || (el.type === "image" ? el.alt : "") || ""} deco={!!el.deco} onApply={(alt, deco) => { a.patchEl({ alt: alt || undefined, deco: deco || undefined } as Partial<SlideElement>); close(); }} />}
          </Popover>
          <Popover label={<span>Arrange</span>} title="Arrange" testId="tb-arrange">
            {(close) => (
              <div className="flex flex-col text-sm">
                {([
                  ["front", "Bring to front"],
                  ["forward", "Bring forward"],
                  ["backward", "Send backward"],
                  ["back", "Send to back"],
                ] as const).map(([k, l]) => (
                  <button key={k} type="button" className="text-left px-2 py-1.5 rounded hover:bg-slate-50" onClick={() => { a.arrange(k); close(); }}>{l}</button>
                ))}
                <div className="h-px bg-slate-100 my-1" />
                {([
                  ["right", "Rotate right 90°"],
                  ["left", "Rotate left 90°"],
                  ["flipH", "Flip horizontal"],
                  ["flipV", "Flip vertical"],
                ] as const).map(([k, l]) => (
                  <button key={k} type="button" className="text-left px-2 py-1.5 rounded hover:bg-slate-50" onClick={() => { a.rotate(k); close(); }}>{l}</button>
                ))}
                <div className="h-px bg-slate-100 my-1" />
                <div className="px-2 pt-1 text-[11px] uppercase tracking-wide text-slate-400">{a.selCount > 1 ? "Align selected objects" : "Align to slide"}</div>
                <div className="grid grid-cols-3 gap-0.5 px-1">
                  {([
                    ["left", "⇤ Left"],
                    ["center", "↔ Center"],
                    ["right", "⇥ Right"],
                    ["top", "⤒ Top"],
                    ["middle", "↕ Middle"],
                    ["bottom", "⤓ Bottom"],
                  ] as const).map(([k, l]) => (
                    <button key={k} type="button" data-testid={`arr-align-${k}`} className="text-left px-1.5 py-1 rounded hover:bg-slate-50 text-xs whitespace-nowrap" onClick={() => { a.align(k); close(); }}>{l}</button>
                  ))}
                </div>
                <button type="button" data-testid="arr-distribute-h" className="text-left px-2 py-1.5 rounded hover:bg-slate-50" onClick={() => { a.distribute("horizontal"); close(); }}>Distribute horizontally</button>
                <button type="button" data-testid="arr-distribute-v" className="text-left px-2 py-1.5 rounded hover:bg-slate-50" onClick={() => { a.distribute("vertical"); close(); }}>Distribute vertically</button>
                <div className="h-px bg-slate-100 my-1" />
                <button type="button" data-testid="arr-group" disabled={a.selCount < 2} className="text-left px-2 py-1.5 rounded hover:bg-slate-50 disabled:opacity-40" onClick={() => { a.group(); close(); }}>Group <span className="text-xs text-slate-400 ml-2">Ctrl+G</span></button>
                <button type="button" data-testid="arr-ungroup" disabled={!a.selGrouped} className="text-left px-2 py-1.5 rounded hover:bg-slate-50 disabled:opacity-40" onClick={() => { a.ungroup(); close(); }}>Ungroup <span className="text-xs text-slate-400 ml-2">Ctrl+Shift+G</span></button>
              </div>
            )}
          </Popover>
          <TB title="Delete" onClick={a.deleteEl}>🗑</TB>
        </>
      )}
      <div className="ml-auto flex items-center gap-1">
        <TB title="Select all objects (Ctrl+A)" testId="tb-select-all-objects" onClick={a.selectAllObjects}>Select objects</TB>
        <TB title="Designer: layout ideas for this slide" testId="tb-designer" onClick={a.toggleDesigner}>✨ Designer</TB>
        <TB title="Transitions & animations" testId="tb-anim" onClick={a.toggleAnim}>✦ Animations</TB>
        <TB title="Slide show from current slide (Shift+F5)" testId="tb-show" onClick={() => a.showFrom(true)}>▶ Present</TB>
      </div>
    </div>
  );
}

/** Alternative text for screen readers, or "decorative" (skipped by them). */
function AltTextForm({ alt, deco, onApply }: { alt: string; deco: boolean; onApply: (alt: string, deco: boolean) => void }) {
  const [v, setV] = useState(alt);
  const [d, setD] = useState(deco);
  return (
    <div className="space-y-2 w-64 text-sm">
      <textarea data-testid="alt-text" disabled={d} className="w-full h-20 rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50" placeholder="How would you describe this to someone who can't see it? (1–2 sentences)" value={d ? "" : v} onChange={(e) => setV(e.target.value)} />
      <label className="flex items-center gap-2 text-slate-700"><input type="checkbox" data-testid="alt-deco" checked={d} onChange={(e) => setD(e.target.checked)} />Mark as decorative</label>
      <div className="flex justify-end"><button type="button" data-testid="alt-apply" className="rounded bg-indigo-600 text-white px-3 py-1" onClick={() => onApply(d ? "" : v.trim(), d)}>Apply</button></div>
    </div>
  );
}

function TableGrid({ onPick }: { onPick: (r: number, c: number) => void }) {
  const [hover, setHover] = useState<[number, number]>([0, 0]);
  return (
    <div>
      <div className="grid grid-cols-8 gap-0.5" onMouseLeave={() => setHover([0, 0])}>
        {Array.from({ length: 64 }, (_, i) => {
          const r = Math.floor(i / 8) + 1, c = (i % 8) + 1;
          const on = r <= hover[0] && c <= hover[1];
          return <button key={i} type="button" data-testid={`table-${r}x${c}`} className={`w-4 h-4 border ${on ? "bg-indigo-200 border-indigo-400" : "border-slate-300"}`} onMouseEnter={() => setHover([r, c])} onClick={() => onPick(r, c)} />;
        })}
      </div>
      <div className="text-xs text-slate-500 mt-1">{hover[0] ? `${hover[0]} × ${hover[1]} table` : "Insert table"}</div>
    </div>
  );
}
