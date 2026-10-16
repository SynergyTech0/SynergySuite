"use client";

import { useEffect, useState } from "react";
import { chartData, type ChartType, type SheetChart } from "@/lib/sheet-charts";
import type { UniverWorkbook } from "@/lib/xlsx";

const COLORS = ["#4f46e5", "#0891b2", "#e11d48", "#d97706", "#16a34a", "#7c3aed", "#475569", "#db2777"];

export function ChartPreview({ chart, book }: { chart: SheetChart; book: UniverWorkbook }) {
  const series = chartData(book, chart);
  const labels = series[0]?.categories || [];
  const limit = chart.type === "line" || chart.type === "area" || chart.type === "scatter" ? 60 : chart.type === "pie" ? 8 : 24;
  const shown = Math.min(labels.length, limit);
  const plotted = series.map((entry) => entry.values.slice(0, shown));
  const values = plotted.flat().filter((value): value is number => value !== null);
  if (!values.length) return <div className="flex h-48 items-center justify-center text-xs text-slate-400">Add numeric values to the selected range</div>;

  if (chart.type === "pie") {
    const first = series[0];
    const parts = first.values.map((value, index) => ({ value: Math.max(0, value || 0), label: first.categories[index] || `${index + 1}` })).filter((part) => part.value > 0);
    if (!parts.length) return <div className="flex h-48 items-center justify-center text-xs text-slate-400">Pie charts need positive values</div>;
    const top = parts.slice(0, 8);
    if (parts.length > 8) top.push({ value: parts.slice(8).reduce((sum, part) => sum + part.value, 0), label: "Other" });
    const total = top.reduce((sum, part) => sum + part.value, 0);
    let angle = -Math.PI / 2;
    return (
      <svg role="img" aria-label={`${chart.title} pie chart`} viewBox="0 0 360 220" className="h-52 w-full">
        {top.map((part, index) => {
          const sweep = 2 * Math.PI * part.value / total;
          const next = angle + sweep;
          const x1 = 118 + 78 * Math.cos(angle);
          const y1 = 110 + 78 * Math.sin(angle);
          const x2 = 118 + 78 * Math.cos(next);
          const y2 = 110 + 78 * Math.sin(next);
          const path = sweep >= 2 * Math.PI - 1e-6
            ? <circle key={index} cx="118" cy="110" r="78" fill={COLORS[index % COLORS.length]} />
            : <path key={index} d={`M 118 110 L ${x1} ${y1} A 78 78 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`} fill={COLORS[index % COLORS.length]}><title>{`${part.label}: ${part.value}`}</title></path>;
          angle = next;
          return path;
        })}
        {top.map((part, index) => <g key={index} transform={`translate(220 ${25 + index * 22})`}><rect width="9" height="9" fill={COLORS[index % COLORS.length]} /><text x="14" y="9" fontSize="11" fill="#334155">{part.label.slice(0, 15)}</text></g>)}
      </svg>
    );
  }

  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const top = 15;
  const bottom = 172;
  const left = 43;
  const right = 345;
  const width = right - left;
  const height = bottom - top;
  const y = (value: number) => bottom - (value - min) / span * height;
  const zeroY = y(0);
  const isBar = chart.type === "bar";
  const xZero = left + (0 - min) / span * width;
  const x = (value: number) => left + (value - min) / span * width;
  const categoryStep = (isBar ? height : width) / Math.max(1, shown);
  const barWidth = Math.max(1, categoryStep * 0.72 / Math.max(1, series.length));

  return (
    <div>
      <svg role="img" aria-label={`${chart.title} ${chart.type} chart`} viewBox="0 0 360 220" className="h-52 w-full">
        {isBar ? <>
          <line x1={xZero} y1={top} x2={xZero} y2={bottom} stroke="#94a3b8" strokeWidth="1" />
          <line x1={left} y1={bottom} x2={right} y2={bottom} stroke="#cbd5e1" strokeWidth="1" />
        </> : <>
          <line x1={left} y1={zeroY} x2={right} y2={zeroY} stroke="#94a3b8" strokeWidth="1" />
          <line x1={left} y1={top} x2={left} y2={bottom} stroke="#cbd5e1" strokeWidth="1" />
        </>}
        {(chart.type === "line" || chart.type === "area") && series.map((entry, seriesIndex) => {
          const points = plotted[seriesIndex].map((value, index) => value === null ? null : { x: left + categoryStep * (index + 0.5), y: y(value), value }).filter((point): point is { x: number; y: number; value: number } => point !== null);
          const color = COLORS[seriesIndex % COLORS.length];
          const line = points.map((point) => `${point.x},${point.y}`).join(" ");
          if (chart.type === "area")
            return <g key={seriesIndex}><polygon fill={color} fillOpacity="0.35" stroke={color} strokeWidth="1.5" points={points.length ? `${points[0].x},${zeroY} ${line} ${points[points.length - 1].x},${zeroY}` : ""}><title>{entry.name}</title></polygon></g>;
          return <g key={seriesIndex}><polyline fill="none" stroke={color} strokeWidth="2.5" points={line} />{points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="3" fill={color}><title>{`${entry.name}: ${point.value}`}</title></circle>)}</g>;
        })}
        {chart.type === "scatter" && (() => {
          // x from the categories when they are numbers, else the point's position.
          const xs = series.map((entry) => entry.categories.slice(0, shown).map((c, i) => (Number.isFinite(Number(c)) ? Number(c) : i + 1)));
          const all = xs.flat();
          const xMin = Math.min(...all);
          const xSpan = Math.max(...all) - xMin || 1;
          return series.map((entry, seriesIndex) => plotted[seriesIndex].map((value, index) => value === null ? null : <circle key={`${seriesIndex}-${index}`} cx={left + 6 + (xs[seriesIndex][index] - xMin) / xSpan * (width - 12)} cy={y(value)} r="3.5" fill={COLORS[seriesIndex % COLORS.length]}><title>{`${entry.name}: (${xs[seriesIndex][index]}, ${value})`}</title></circle>));
        })()}
        {(chart.type === "column" || chart.type === "bar") && series.flatMap((entry, seriesIndex) => plotted[seriesIndex].map((value, index) => {
          if (value === null) return null;
          const color = COLORS[seriesIndex % COLORS.length];
          if (isBar) {
            const yy = top + categoryStep * index + categoryStep * 0.14 + seriesIndex * barWidth;
            return <rect key={`${seriesIndex}-${index}`} x={Math.min(xZero, x(value))} y={yy} width={Math.abs(x(value) - xZero)} height={barWidth} fill={color}><title>{`${labels[index]} — ${entry.name}: ${value}`}</title></rect>;
          }
          const xx = left + categoryStep * index + categoryStep * 0.14 + seriesIndex * barWidth;
          return <rect key={`${seriesIndex}-${index}`} x={xx} y={Math.min(zeroY, y(value))} width={barWidth} height={Math.abs(zeroY - y(value))} fill={color}><title>{`${labels[index]} — ${entry.name}: ${value}`}</title></rect>;
        }))}
        {chart.type !== "scatter" && labels.slice(0, shown).map((label, index) => {
          if (shown > 12 && index % Math.ceil(shown / 12)) return null;
          return isBar
            ? <text key={index} x={left - 5} y={top + categoryStep * (index + 0.6)} textAnchor="end" fontSize="9" fill="#64748b">{label.slice(0, 6)}</text>
            : <text key={index} x={left + categoryStep * (index + 0.5)} y="188" textAnchor="middle" fontSize="9" fill="#64748b">{label.slice(0, 7)}</text>;
        })}
        {isBar ? <>
          <text x={left} y="188" textAnchor="start" fontSize="9" fill="#64748b">{min.toFixed(1)}</text>
          <text x={right} y="188" textAnchor="end" fontSize="9" fill="#64748b">{max.toFixed(1)}</text>
        </> : <>
          <text x={left - 5} y={top + 4} textAnchor="end" fontSize="9" fill="#64748b">{max.toFixed(1)}</text>
          <text x={left - 5} y={bottom + 3} textAnchor="end" fontSize="9" fill="#64748b">{min.toFixed(1)}</text>
        </>}
        {series.slice(0, 4).map((entry, index) => <g key={index} transform={`translate(${left + index * 78} 206)`}><rect width="8" height="8" fill={COLORS[index % COLORS.length]} /><text x="12" y="8" fontSize="9" fill="#475569">{entry.name.slice(0, 10)}</text></g>)}
      </svg>
      {labels.length > shown && <div className="text-center text-[10px] text-slate-400">Preview shows the first {shown} of {labels.length} points</div>}
    </div>
  );
}

function ChartCard({ chart, book, canEdit, onUpdate, onRemove, onUseSelection, onMoveToSheet }: {
  chart: SheetChart;
  book: UniverWorkbook;
  canEdit: boolean;
  onUpdate: (chart: SheetChart) => void;
  onRemove: (id: string) => void;
  onUseSelection: (id: string) => void;
  onMoveToSheet?: (id: string) => void;
}) {
  const [title, setTitle] = useState(chart.title);
  useEffect(() => setTitle(chart.title), [chart.title]);
  const saveTitle = () => { if (title.trim() && title.trim() !== chart.title) onUpdate({ ...chart, title: title.trim() }); };
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm" aria-label={`${chart.title} chart`}>
      <div className="flex items-center gap-1">
        <input aria-label="Chart title" value={title} disabled={!canEdit} onChange={(event) => setTitle(event.target.value)} onBlur={saveTitle} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-sm font-medium text-slate-700 hover:border-slate-200 focus:border-indigo-300 focus:outline-none disabled:bg-white" />
        <button type="button" aria-label={`Delete ${chart.title} chart`} disabled={!canEdit} onClick={() => onRemove(chart.id)} className="rounded px-1.5 py-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40">×</button>
      </div>
      <ChartPreview chart={chart} book={book} />
      <div className="flex items-center gap-2 border-t border-slate-100 pt-2">
        <select aria-label="Chart type" value={chart.type} disabled={!canEdit} onChange={(event) => onUpdate({ ...chart, type: event.target.value as ChartType })} className="rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-600">
          <option value="column">Column</option><option value="bar">Bar</option><option value="line">Line</option><option value="pie">Pie</option><option value="area">Area</option><option value="scatter">Scatter</option>
        </select>
        <button type="button" disabled={!canEdit} onClick={() => onUseSelection(chart.id)} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40">Use selected cells</button>
        {onMoveToSheet && <button type="button" disabled={!canEdit} onClick={() => onMoveToSheet(chart.id)} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40">Move to own sheet</button>}
      </div>
    </section>
  );
}

export default function SheetCharts({ charts, book, canEdit, onUpdate, onRemove, onUseSelection, onMoveToSheet, onClose }: {
  charts: SheetChart[];
  book: UniverWorkbook;
  canEdit: boolean;
  onUpdate: (chart: SheetChart) => void;
  onRemove: (id: string) => void;
  onUseSelection: (id: string) => void;
  onMoveToSheet?: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <aside aria-label="Charts panel" className="flex w-[370px] shrink-0 flex-col border-l border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2"><h2 className="text-sm font-semibold text-slate-700">Charts</h2><button type="button" aria-label="Close charts" onClick={onClose} className="rounded px-1.5 text-slate-400 hover:bg-slate-200">×</button></div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">{charts.length ? charts.map((chart) => <ChartCard key={chart.id} chart={chart} book={book} canEdit={canEdit} onUpdate={onUpdate} onRemove={onRemove} onUseSelection={onUseSelection} onMoveToSheet={onMoveToSheet} />) : <p className="text-xs leading-5 text-slate-500">Select a labeled data range, then choose Insert → Chart.</p>}</div>
    </aside>
  );
}
