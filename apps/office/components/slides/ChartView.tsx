"use client";

// Charts drawn as plain SVG at the element's size in slide px: columns/bars
// (clustered or stacked), lines, areas, pies, doughnuts and scatter plots, with
// optional data labels and a legend on any side.
import React, { useId } from "react";
import { CHART_COLORS, seriesType, type ChartEl, type ChartSeries } from "@/lib/slides/model";
import { axisScale, fitTrend, formatNumber } from "@/lib/slides/chart";

const color = (value: string | undefined, index: number) => `#${value && /^[0-9a-f]{6}$/i.test(value) ? value : CHART_COLORS[index % CHART_COLORS.length]}`;
const short = (value: string) => (value.length > 15 ? `${value.slice(0, 14)}…` : value);
const finite = (v: number | undefined) => (Number.isFinite(v) ? (v as number) : 0);

/** 100% stacked: each value as its share of the category's total (of each chart type and axis). */
function sharesOf(el: ChartEl, list: ChartSeries[], n: number): ChartSeries[] {
  const key = (s: ChartSeries) => `${seriesType(el, s)}:${s.y2 ? 2 : 1}`;
  const totals = new Map<string, number[]>();
  for (const s of list) {
    const t = totals.get(key(s)) || Array.from({ length: n }, () => 0);
    for (let i = 0; i < n; i++) t[i] += Math.abs(finite(s.values?.[i]));
    totals.set(key(s), t);
  }
  return list.map((s) => ({ ...s, values: Array.from({ length: n }, (_, i) => { const t = totals.get(key(s))![i]; return t ? finite(s.values?.[i]) / t : 0; }) }));
}

export function ChartView({ el, font }: { el: ChartEl; font: string }) {
  const clipId = `plot-${el.id}-${useId().replace(/:/g, "")}`;
  const valAx = el.valAx || {};
  const catAx = el.catAx || {};
  // 100% stacked: values become shares of their category's total
  const percent = !!el.percent && !!el.stacked && el.chartType !== "scatter" && el.chartType !== "pie" && el.chartType !== "doughnut";
  const fmt = (v: number) => formatNumber(v, valAx.fmt || (percent ? "0%" : undefined));
  const w = Math.max(100, el.w);
  const h = Math.max(100, el.h);
  const categories = (el.categories || []).slice(0, 100);
  const rawSeries = (el.series || []).slice(0, 20);
  const series = percent ? sharesOf(el, rawSeries, Math.min(100, (el.categories || []).length)) : rawSeries;
  const kind = el.chartType;
  const typeOf = (s: ChartSeries) => seriesType(el, s);
  const round = kind === "pie" || kind === "doughnut";
  const hasY2 = !round && kind !== "scatter" && series.some((s) => s.y2);
  const legend = el.showLegend === false ? null : el.legendPos || "b";
  const label = `${kind} chart${el.title ? `: ${el.title}` : ""}`;
  // legend entries: categories for pies, series otherwise
  const entries = round ? categories.map((c, i) => ({ name: c, color: color(undefined, i) })) : series.map((s, i) => ({ name: s.name, color: color(s.color, i) }));
  const side = legend === "r" || legend === "l";
  const legendW = side ? Math.min(160, w * 0.3) : 0;
  const titleH = el.title ? 40 : 12;
  const box = {
    left: (legend === "l" ? legendW : 0) + (round ? 12 : 56 + (valAx.title ? 22 : 0)),
    right: (legend === "r" ? legendW : 0) + (hasY2 ? 52 : 20),
    top: titleH + 12 + (legend === "t" ? 28 : 0),
    bottom: h - (round ? 12 : 42 + (catAx.title ? 20 : 0)) - (legend === "b" ? 30 : 0),
  };
  const plotW = Math.max(1, w - box.left - box.right);
  const plotH = Math.max(1, box.bottom - box.top);

  const legendEls =
    legend &&
    entries.map((e, i) => {
      const pos = side
        ? { x: legend === "r" ? w - legendW + 6 : 8, y: box.top + i * 20 }
        : { x: box.left + i * Math.min(140, plotW / Math.max(1, entries.length)), y: legend === "t" ? titleH + 6 : h - 18 };
      return (
        <g key={i} transform={`translate(${pos.x},${pos.y})`}>
          <rect width="11" height="11" fill={e.color} />
          <text x="16" y="10" fontSize="11" fill="#374151">
            <title>{e.name}</title>
            {short(e.name)}
          </text>
        </g>
      );
    });

  const svg = (children: React.ReactNode) => (
    <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} style={{ display: "block", background: "white", fontFamily: font }}>
      {el.title && <text x={w / 2} y={27} textAnchor="middle" fontSize="18" fontWeight="600" fill="#1f2937">{el.title}</text>}
      {children}
      {legendEls}
    </svg>
  );

  if (round) {
    const vals = categories.map((_, i) => Math.max(0, finite(series[0]?.values?.[i])));
    const total = vals.reduce((a, b) => a + b, 0);
    const radius = Math.max(1, Math.min(plotW, plotH) * 0.46);
    const hole = kind === "doughnut" ? radius * 0.5 : 0;
    const cx = box.left + plotW / 2;
    const cy = box.top + plotH / 2;
    let angle = -Math.PI / 2;
    const pt = (r: number, a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
    return svg(
      total > 0 ? (
        vals.map((v, i) => {
          if (!v) return null;
          const start = angle;
          angle += (v / total) * Math.PI * 2;
          const end = v === total ? start + Math.PI * 2 - 1e-4 : angle;
          const large = end - start > Math.PI ? 1 : 0;
          const d = hole
            ? `M ${pt(radius, start)} A ${radius} ${radius} 0 ${large} 1 ${pt(radius, end)} L ${pt(hole, end)} A ${hole} ${hole} 0 ${large} 0 ${pt(hole, start)} Z`
            : `M ${cx} ${cy} L ${pt(radius, start)} A ${radius} ${radius} 0 ${large} 1 ${pt(radius, end)} Z`;
          const mid = (start + end) / 2;
          const lr = hole ? (radius + hole) / 2 : radius * 0.65;
          return (
            <g key={i}>
              <path d={d} fill={color(undefined, i)} stroke="white" strokeWidth="2">
                <title>{`${categories[i]}: ${v}`}</title>
              </path>
              {el.dataLabels && (
                <text x={cx + lr * Math.cos(mid)} y={cy + lr * Math.sin(mid) + 4} textAnchor="middle" fontSize="12" fill="white" fontWeight="600">{fmt(v)}</text>
              )}
            </g>
          );
        })
      ) : (
        <text x={cx} y={cy} textAnchor="middle" fill="#64748b" fontSize="16">Add chart data</text>
      ),
    );
  }

  const n = Math.max(1, categories.length);
  const stacked = !!el.stacked && kind !== "scatter";
  const horizontal = kind === "bar" && el.barDir === "bar";
  // value range (stacked: positive and negative sums per category)
  // the values an axis must show: each chart type's series stack among themselves
  const valsOf = (list: ChartSeries[]): number[] => {
    if (!stacked) return list.flatMap((s) => (s.values || []).slice(0, categories.length).filter(Number.isFinite));
    const groups = new Map<string, ChartSeries[]>();
    for (const s of list) groups.set(typeOf(s), [...(groups.get(typeOf(s)) || []), s]);
    return [...groups.values()].flatMap((g) =>
      categories.flatMap((_, ci) => {
        let pos = 0, neg = 0;
        for (const s of g) {
          const v = finite(s.values?.[ci]);
          if (v >= 0) pos += v;
          else neg += v;
        }
        return [pos, neg];
      }),
    );
  };
  const primary = series.filter((s) => !(hasY2 && s.y2));
  const vals = valsOf(primary.length ? primary : series);
  const ax = axisScale(Math.min(0, ...vals), Math.max(0, ...vals), percent && valAx.max === undefined ? { ...valAx, max: Math.max(1, ...vals) > 1 ? undefined : 1 } : valAx);
  const range = ax.hi - ax.lo || 1;
  const vals2 = hasY2 ? valsOf(series.filter((s) => s.y2)) : [];
  const ax2 = hasY2 ? axisScale(Math.min(0, ...vals2), Math.max(0, ...vals2), {}) : null;
  // value → pixel along the value axis (or the secondary one); category index → centre along the category axis
  const vPos = (v: number, y2 = false) => {
    const a = y2 && ax2 ? ax2 : ax;
    const rg = a.hi - a.lo || 1;
    return horizontal ? box.left + ((v - a.lo) / rg) * plotW : box.top + ((a.hi - v) / rg) * plotH;
  };
  const catLen = horizontal ? plotH : plotW;
  // horizontal bars list the first category at the bottom, next to the origin, as PowerPoint does
  const cPos = (i: number) => (horizontal ? box.top + ((n - i - 0.5) * catLen) / n : box.left + ((i + 0.5) * catLen) / n);
  const zero = vPos(Math.min(ax.hi, Math.max(ax.lo, 0)));

  // scatter: x values come from the category column
  const xsRaw = categories.map((c) => Number(c));
  const xAx = kind === "scatter" && xsRaw.length && xsRaw.every(Number.isFinite) ? axisScale(Math.min(...xsRaw), Math.max(...xsRaw), catAx) : null;
  const xPos = (i: number) => (xAx ? box.left + ((xsRaw[i] - xAx.lo) / (xAx.hi - xAx.lo || 1)) * plotW : cPos(i));

  const showGrid = valAx.grid !== false;
  const gridLine = (p: number, key: string, minor = false) =>
    horizontal ? <line key={key} x1={p} x2={p} y1={box.top} y2={box.bottom} stroke={minor ? "#f1f5f9" : "#e5e7eb"} data-grid={minor ? "minor" : "major"} /> : <line key={key} x1={box.left} x2={w - box.right} y1={p} y2={p} stroke={minor ? "#f1f5f9" : "#e5e7eb"} data-grid={minor ? "minor" : "major"} />;
  const grid = [
    ...ax.minor.map((v, i) => gridLine(vPos(v), `m${i}`, true)),
    ...ax.ticks.map((v, i) => {
      const p = vPos(v);
      return (
        <g key={i}>
          {showGrid && gridLine(p, "l")}
          {horizontal ? (
            <text x={p} y={box.bottom + 16} textAnchor="middle" fontSize="11" fill="#64748b">{fmt(v)}</text>
          ) : (
            <text x={box.left - 8} y={p + 4} textAnchor="end" fontSize="11" fill="#64748b">{fmt(v)}</text>
          )}
        </g>
      );
    }),
  ];
  const grid2 = ax2
    ? ax2.ticks.map((v, i) => (
        <text key={`y2${i}`} x={w - box.right + 8} y={vPos(v, true) + 4} textAnchor="start" fontSize="11" fill="#64748b" data-axis="y2">{formatNumber(v, undefined)}</text>
      ))
    : null;
  // category-axis gridlines: between categories, or at the X ticks of a scatter chart
  const xTickPos = (v: number) => (xAx ? box.left + ((v - xAx.lo) / (xAx.hi - xAx.lo || 1)) * plotW : 0);
  const catGrid = !catAx.grid
    ? null
    : xAx
      ? xAx.ticks.map((v, i) => <line key={`cg${i}`} x1={xTickPos(v)} x2={xTickPos(v)} y1={box.top} y2={box.bottom} stroke="#e5e7eb" data-grid="cat" />)
      : Array.from({ length: n + 1 }, (_, i) => {
          const p = (horizontal ? box.top : box.left) + (i * catLen) / n;
          return horizontal ? <line key={`cg${i}`} x1={box.left} x2={w - box.right} y1={p} y2={p} stroke="#e5e7eb" data-grid="cat" /> : <line key={`cg${i}`} x1={p} x2={p} y1={box.top} y2={box.bottom} stroke="#e5e7eb" data-grid="cat" />;
        });
  const axisTitles = (
    <>
      {valAx.title && (horizontal ? (
        <text x={box.left + plotW / 2} y={box.bottom + 36} textAnchor="middle" fontSize="12" fill="#374151" data-axis-title="val">{valAx.title}</text>
      ) : (
        <text x={0} y={0} transform={`translate(${box.left - 46},${box.top + plotH / 2}) rotate(-90)`} textAnchor="middle" fontSize="12" fill="#374151" data-axis-title="val">{valAx.title}</text>
      ))}
      {catAx.title && (horizontal ? (
        <text x={0} y={0} transform={`translate(${box.left - 46},${box.top + plotH / 2}) rotate(-90)`} textAnchor="middle" fontSize="12" fill="#374151" data-axis-title="cat">{catAx.title}</text>
      ) : (
        <text x={box.left + plotW / 2} y={box.bottom + 38} textAnchor="middle" fontSize="12" fill="#374151" data-axis-title="cat">{catAx.title}</text>
      ))}
    </>
  );
  const catLabels = xAx
    ? xAx.ticks.map((v, i) => {
        return <text key={i} x={xTickPos(v)} y={box.bottom + 20} textAnchor="middle" fontSize="11" fill="#475569">{formatNumber(v, catAx.fmt)}</text>;
      })
    : categories.map((c, i) =>
        horizontal ? (
          <text key={i} x={box.left - 8} y={cPos(i) + 4} textAnchor="end" fontSize="11" fill="#475569"><title>{c}</title>{short(c)}</text>
        ) : (
          <text key={i} x={cPos(i)} y={box.bottom + 20} textAnchor="middle" fontSize="11" fill="#475569"><title>{c}</title>{short(c)}</text>
        ),
      );
  const valueLabel = (x: number, y: number, v: number, anchor: "middle" | "start" = "middle") =>
    el.dataLabels ? <text x={x} y={y} textAnchor={anchor} fontSize="11" fill="#1f2937">{fmt(v)}</text> : null;

  let marks: React.ReactNode = null;
  const barMarks: React.ReactNode[] = [];
  const bars = series.map((s, si) => ({ s, si })).filter(({ s }) => typeOf(s) === "bar");
  if (bars.length && kind !== "scatter") {
    const groupW = catLen / n;
    const nb = bars.length;
    const barW = stacked ? Math.min(80, groupW * 0.6) : Math.max(1, Math.min(50, (groupW * 0.78) / Math.max(1, nb)));
    const pos0 = categories.map(() => 0), neg0 = categories.map(() => 0);
    const pos2 = categories.map(() => 0), neg2 = categories.map(() => 0);
    barMarks.push(...bars.flatMap(({ s, si }, bi) =>
      categories.map((c, ci) => {
        const y2 = hasY2 && !!s.y2;
        const [pos, neg] = y2 ? [pos2, neg2] : [pos0, neg0];
        const v = finite(s.values?.[ci]);
        let a = 0, b = v; // extent along the value axis
        if (stacked) {
          a = v >= 0 ? pos[ci] : neg[ci];
          b = a + v;
          if (v >= 0) pos[ci] = b;
          else neg[ci] = b;
        }
        const along = stacked ? cPos(ci) - barW / 2 : cPos(ci) - (barW * nb) / 2 + bi * barW;
        const A = y2 && ax2 ? ax2 : ax;
        const clamp = (x: number) => Math.min(A.hi, Math.max(A.lo, x));
        const p1 = vPos(clamp(a), y2), p2 = vPos(clamp(b), y2);
        const thick = Math.max(1, barW - (stacked ? 0 : 2));
        const rect = horizontal
          ? { x: Math.min(p1, p2), y: along, width: Math.max(0, Math.abs(p2 - p1)), height: thick }
          : { x: along, y: Math.min(p1, p2), width: thick, height: Math.max(0, Math.abs(p2 - p1)) };
        return (
          <g key={`${si}-${ci}`}>
            <rect {...rect} fill={color(s.color, si)}>
              <title>{`${s.name} · ${c}: ${v}`}</title>
            </rect>
            {horizontal
              ? valueLabel(stacked ? (p1 + p2) / 2 : p2 + 4, along + thick / 2 + 4, v, stacked ? "middle" : "start")
              : valueLabel(along + thick / 2, stacked ? (p1 + p2) / 2 + 4 : p2 - 4, v)}
          </g>
        );
      }),
    ));
  }
  if (kind === "bar" || kind === "line" || kind === "area") {
    // stacking runs within each chart type and axis
    const accs = new Map<string, number[]>();
    const layers = series.map((s) => {
      const key = `${typeOf(s)}:${hasY2 && s.y2 ? 2 : 1}`;
      const acc = accs.get(key) || categories.map(() => 0);
      accs.set(key, acc);
      return categories.map((_, ci) => {
        const v = finite(s.values?.[ci]);
        const base = stacked ? acc[ci] : 0;
        if (stacked) acc[ci] += v;
        return { v, base, top: base + v };
      });
    });
    const lineAreas = series.map((s, si) => ({ s, si })).filter(({ s }) => typeOf(s) === "line" || typeOf(s) === "area");
    // areas behind lines; unstacked areas: the first series last so it stays in front, as PowerPoint does
    const areas = lineAreas.filter(({ s }) => typeOf(s) === "area").map(({ si }) => si);
    const order = [...(stacked ? areas : [...areas].reverse()), ...lineAreas.filter(({ s }) => typeOf(s) === "line").map(({ si }) => si)];
    marks = [...order.filter((si) => typeOf(series[si]) === "area").map((si) => lineArea(si)), ...barMarks, ...order.filter((si) => typeOf(series[si]) === "line").map((si) => lineArea(si))];
    function lineArea(si: number) {
      const s = series[si];
      const y2 = hasY2 && !!s.y2;
      const k = typeOf(s);
      const pts = layers[si].map((p, ci) => `${cPos(ci)},${vPos(p.top, y2)}`);
      const basePts = layers[si].map((p, ci) => `${cPos(ci)},${vPos(p.base, y2)}`).reverse();
      return (
        <g key={si} data-series-type={k}>
          {k === "area" ? (
            <polygon points={[...pts, ...basePts].join(" ")} fill={color(s.color, si)} fillOpacity={stacked ? 0.9 : 0.75}>
              <title>{s.name}</title>
            </polygon>
          ) : (
            <polyline points={pts.join(" ")} fill="none" stroke={color(s.color, si)} strokeWidth="3" />
          )}
          {layers[si].map((p, ci) => (
            <g key={ci}>
              {k === "line" && (
                <circle cx={cPos(ci)} cy={vPos(p.top, y2)} r="4" fill={color(s.color, si)}>
                  <title>{`${s.name} · ${categories[ci]}: ${p.v}`}</title>
                </circle>
              )}
              {valueLabel(cPos(ci), vPos(p.top, y2) - 8, p.v)}
            </g>
          ))}
        </g>
      );
    }
  } else if (kind === "scatter") {
    marks = series.map((s, si) => (
      <g key={si}>
        {categories.map((c, ci) => {
          const v = finite(s.values?.[ci]);
          return (
            <g key={ci}>
              <circle cx={xPos(ci)} cy={vPos(v)} r="5" fill={color(s.color, si)}>
                <title>{`${s.name} · ${c}: ${v}`}</title>
              </circle>
              {valueLabel(xPos(ci), vPos(v) - 8, v)}
            </g>
          );
        })}
      </g>
    ));
  }

  // trendlines: x is the category number (1, 2, ...) or the scatter X value
  const trends = series.flatMap((s, si) => {
    if (!s.trend || horizontal) return [];
    const xs = categories.map((_, ci) => (xAx ? xsRaw[ci] : ci + 1));
    const ys = categories.map((_, ci) => finite(s.values?.[ci]));
    const fit = fitTrend(xs, ys, s.trend);
    if (!fit) return [];
    const px = (x: number) => (xAx ? xTickPos(x) : cPos(x - 1));
    let pts: [number, number][];
    if (fit.points) pts = fit.points;
    else {
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      pts = Array.from({ length: 61 }, (_, k) => x0 + ((x1 - x0) * k) / 60).map((x) => [x, fit.f!(x)] as [number, number]).filter(([, y]) => Number.isFinite(y));
    }
    if (pts.length < 2) return [];
    const label = [s.trend.eq && fit.eq, s.trend.r2 && fit.r2 !== undefined ? `R² = ${fit.r2.toFixed(4)}` : ""].filter(Boolean);
    const end = pts[pts.length - 1];
    return [
      <g key={`t${si}`} data-trendline={s.trend.type}>
        <polyline points={pts.map(([x, y]) => `${px(x)},${vPos(y, hasY2 && !!s.y2)}`).join(" ")} fill="none" stroke={color(s.color, si)} strokeWidth="2" strokeDasharray="6 4" />
        {label.map((t, k) => (
          <text key={k} x={Math.min(px(end[0]), w - box.right) - 4} y={Math.max(box.top + 12, vPos(end[1]) - 10 - (label.length - 1 - k) * 14)} textAnchor="end" fontSize="11" fill="#1f2937" data-trend-label="">{t}</text>
        ))}
      </g>,
    ];
  });

  return svg(
    <>
      <defs><clipPath id={clipId}><rect x={box.left - 8} y={box.top - 18} width={plotW + 16} height={plotH + 20} /></clipPath></defs>
      {catGrid}
      {grid}
      {horizontal ? <line x1={zero} x2={zero} y1={box.top} y2={box.bottom} stroke="#94a3b8" /> : <line x1={box.left} x2={w - box.right} y1={zero} y2={zero} stroke="#94a3b8" />}
      {catLabels}
      {grid2}
      {axisTitles}
      <g clipPath={`url(#${clipId})`}>{marks}{trends}</g>
    </>,
  );
}
