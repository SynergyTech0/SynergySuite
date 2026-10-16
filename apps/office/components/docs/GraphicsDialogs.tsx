"use client";

// Insert/edit dialogs for charts (type, data typed or pasted as a table,
// title, legend, labels) and SmartArt (layout, outline, colour), with a live
// preview drawn the same way as in the document.
import { useMemo, useState } from "react";
import { CHART_TYPES, type ChartType } from "@/lib/slides/model";
import { DIAGRAMS, type DiagramKind } from "@/lib/slides/smartart";
import { ChartView } from "@/components/slides/ChartView";
import { chartTableText, diagramSvg, parseChartTable, parseOutline, outlineText, sampleChart, type ChartData, type DiagramData } from "@/lib/docs/word-graphics";
import { Modal, btnCls, inputCls, Field } from "./WordDialogs";

export function ChartDialog({ initial, onOk, onClose }: { initial?: ChartData | null; onOk: (c: ChartData) => void; onClose: () => void }) {
  const start = initial || sampleChart();
  const [type, setType] = useState<ChartType>(start.chartType);
  const [title, setTitle] = useState(start.title || "");
  const [data, setData] = useState(chartTableText(start));
  const [stacked, setStacked] = useState(!!start.stacked);
  const [horizontal, setHorizontal] = useState(start.barDir === "bar");
  const [labels, setLabels] = useState(!!start.dataLabels);
  const [legend, setLegend] = useState<"none" | "b" | "t" | "r" | "l">(start.showLegend === false ? "none" : start.legendPos || "b");
  // combo charts: each series' own chart type and axis, by position
  const [perSeries, setPerSeries] = useState<{ type?: "bar" | "line" | "area"; y2?: boolean }[]>(() => start.series.map((x) => ({ type: x.type, y2: x.y2 })));
  const comboable = type === "bar" || type === "line" || type === "area";
  const chart: ChartData = useMemo(() => {
    const t = parseChartTable(data);
    return {
      ...start,
      chartType: type,
      title: title.trim() || undefined,
      categories: t.categories,
      series: t.series.map((s, i) => {
        const { type: _t, y2: _y, ...rest } = start.series[i] || {};
        const own = comboable ? perSeries[i] || {} : {};
        return { ...rest, ...s, values: s.values, ...(own.type && own.type !== type ? { type: own.type } : {}), ...(own.y2 ? { y2: true } : {}) };
      }),
      stacked: stacked && type !== "pie" && type !== "doughnut" && type !== "scatter" ? true : undefined,
      barDir: type === "bar" && horizontal ? "bar" : undefined,
      dataLabels: labels || undefined,
      showLegend: legend !== "none",
      legendPos: legend === "none" ? undefined : legend,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, title, data, stacked, horizontal, labels, legend, perSeries]);
  return (
    <Modal
      title={initial ? "Edit chart" : "Insert chart"}
      wide
      onClose={onClose}
      footer={
        <>
          <button className={`${btnCls} text-slate-600 hover:bg-slate-100`} onClick={onClose}>Cancel</button>
          <button className={`${btnCls} bg-indigo-600 text-white hover:bg-indigo-700`} data-testid="chart-ok" disabled={!chart.series.length} onClick={() => onOk(chart)}>OK</button>
        </>
      }
    >
      <div className="grid grid-cols-[1fr_1fr] gap-4">
        <div className="space-y-2">
          <Field label="Chart type">
            <select aria-label="Chart type" className={inputCls} value={type} onChange={(e) => setType(e.target.value as ChartType)}>
              {CHART_TYPES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Chart title">
            <input aria-label="Chart title" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Data (first row: series names; first column: categories; tab- or comma-separated)">
            <textarea aria-label="Chart data" className="border border-slate-300 rounded-md px-2 py-1 text-xs font-mono h-36" value={data} onChange={(e) => setData(e.target.value)} />
          </Field>
          {comboable && chart.series.length > 1 && (
            <div className="space-y-1 text-xs text-slate-600" data-testid="chart-series-types">
              <div className="font-medium">Series chart type (combo)</div>
              {chart.series.map((x, k) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="w-24 truncate">{x.name}</span>
                  <select
                    aria-label={`Chart type of ${x.name}`}
                    data-testid={`chart-series-type-${k}`}
                    className="h-6 border border-slate-300 rounded px-1"
                    value={perSeries[k]?.type || type}
                    onChange={(e) => setPerSeries(chart.series.map((_, j) => (j === k ? { ...perSeries[j], type: e.target.value === type ? undefined : (e.target.value as "bar" | "line" | "area") } : perSeries[j] || {})))}
                  >
                    <option value="bar">Column</option>
                    <option value="line">Line</option>
                    <option value="area">Area</option>
                  </select>
                  <label className="flex items-center gap-1">
                    <input type="checkbox" data-testid={`chart-series-y2-${k}`} checked={!!perSeries[k]?.y2} onChange={(e) => setPerSeries(chart.series.map((_, j) => (j === k ? { ...perSeries[j], y2: e.target.checked || undefined } : perSeries[j] || {})))} />
                    Secondary axis
                  </label>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-3 text-xs text-slate-600">
            {(type === "bar" || type === "line" || type === "area") && <label className="flex items-center gap-1"><input type="checkbox" checked={stacked} onChange={(e) => setStacked(e.target.checked)} /> Stacked</label>}
            {type === "bar" && <label className="flex items-center gap-1"><input type="checkbox" checked={horizontal} onChange={(e) => setHorizontal(e.target.checked)} /> Horizontal bars</label>}
            <label className="flex items-center gap-1"><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Data labels</label>
            <label className="flex items-center gap-1">
              Legend
              <select aria-label="Legend" className="h-6 border border-slate-300 rounded px-1" value={legend} onChange={(e) => setLegend(e.target.value as typeof legend)}>
                <option value="none">None</option>
                <option value="b">Bottom</option>
                <option value="t">Top</option>
                <option value="r">Right</option>
                <option value="l">Left</option>
              </select>
            </label>
          </div>
        </div>
        <div className="border border-slate-200 rounded-md overflow-hidden h-[288px]" data-testid="chart-preview">
          <ChartView el={{ ...chart, id: "preview", type: "chart", x: 0, y: 0, w: 420, h: 288, z: 0 } as never} font="Calibri, Carlito, sans-serif" />
        </div>
      </div>
    </Modal>
  );
}

export function SmartArtDialog({ initial, onOk, onClose }: { initial?: DiagramData | null; onOk: (d: DiagramData) => void; onClose: () => void }) {
  const [kind, setKind] = useState<DiagramKind>(initial?.kind || "process");
  const [text, setText] = useState(initial ? outlineText(initial.items) : "Plan\nBuild\nTest\nShip");
  const [accent, setAccent] = useState(`#${(initial?.accent || "4472C4").toLowerCase()}`);
  const d: DiagramData = { kind, items: parseOutline(text), accent: accent.replace("#", "").toUpperCase() };
  return (
    <Modal
      title={initial ? "Edit SmartArt" : "Insert SmartArt"}
      wide
      onClose={onClose}
      footer={
        <>
          <button className={`${btnCls} text-slate-600 hover:bg-slate-100`} onClick={onClose}>Cancel</button>
          <button className={`${btnCls} bg-indigo-600 text-white hover:bg-indigo-700`} data-testid="smartart-ok" disabled={!d.items.length} onClick={() => onOk(d)}>OK</button>
        </>
      }
    >
      <div className="grid grid-cols-[1fr_1fr] gap-4">
        <div className="space-y-2">
          <div className="grid grid-cols-5 gap-1">
            {DIAGRAMS.map((g) => (
              <button key={g.id} title={g.hint} data-diagram={g.id} onClick={() => setKind(g.id)} className={`text-[11px] rounded border px-1 py-2 ${kind === g.id ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 hover:bg-slate-50"}`}>
                {g.label}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-slate-500">{DIAGRAMS.find((g) => g.id === kind)?.hint}</div>
          <Field label="Text (one item a line; indent with two spaces for a level below)">
            <textarea aria-label="SmartArt text" className="border border-slate-300 rounded-md px-2 py-1 text-sm h-40" value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <Field label="Colour">
            <input type="color" aria-label="SmartArt colour" className="h-8 w-16 border border-slate-300 rounded" value={accent} onChange={(e) => setAccent(e.target.value)} />
          </Field>
        </div>
        <div className="border border-slate-200 rounded-md overflow-hidden bg-white" data-testid="smartart-preview" dangerouslySetInnerHTML={{ __html: diagramSvg(d, 400, 260) }} />
      </div>
    </Modal>
  );
}
