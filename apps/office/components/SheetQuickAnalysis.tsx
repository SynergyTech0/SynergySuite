"use client";

// Quick Analysis (Ctrl+Q): one click to format, chart, total, table or
// sparkline the selected data, as Excel's button beside a selection offers.
import { useState } from "react";
import { Modal } from "./SheetDialogs";
import type { TotalKind } from "@/lib/quick-analysis";

export type QuickAction =
  | { tab: "formatting"; kind: "dataBar" | "colorScale" | "iconSet" | "greaterThan" | "top10" | "clear" }
  | { tab: "charts"; kind: "column" | "bar" | "line" | "pie" }
  | { tab: "totals"; kind: TotalKind; dir: "rows" | "columns" }
  | { tab: "tables"; kind: "table" | "pivot" }
  | { tab: "sparklines"; kind: "line" | "column" | "winloss" };

const TABS = [
  ["formatting", "Formatting"],
  ["charts", "Charts"],
  ["totals", "Totals"],
  ["tables", "Tables"],
  ["sparklines", "Sparklines"],
] as const;

const OPTIONS: Record<(typeof TABS)[number][0], [QuickAction, string][]> = {
  formatting: [
    [{ tab: "formatting", kind: "dataBar" }, "Data Bars"],
    [{ tab: "formatting", kind: "colorScale" }, "Color Scale"],
    [{ tab: "formatting", kind: "iconSet" }, "Icon Set"],
    [{ tab: "formatting", kind: "greaterThan" }, "Greater Than Average"],
    [{ tab: "formatting", kind: "top10" }, "Top 10%"],
    [{ tab: "formatting", kind: "clear" }, "Clear Format"],
  ],
  charts: [
    [{ tab: "charts", kind: "column" }, "Clustered Column"],
    [{ tab: "charts", kind: "bar" }, "Clustered Bar"],
    [{ tab: "charts", kind: "line" }, "Line"],
    [{ tab: "charts", kind: "pie" }, "Pie"],
  ],
  totals: [
    [{ tab: "totals", kind: "sum", dir: "rows" }, "Sum (row below)"],
    [{ tab: "totals", kind: "average", dir: "rows" }, "Average (row below)"],
    [{ tab: "totals", kind: "count", dir: "rows" }, "Count (row below)"],
    [{ tab: "totals", kind: "percent", dir: "rows" }, "% Total (row below)"],
    [{ tab: "totals", kind: "running", dir: "rows" }, "Running Total (row below)"],
    [{ tab: "totals", kind: "sum", dir: "columns" }, "Sum (column right)"],
    [{ tab: "totals", kind: "average", dir: "columns" }, "Average (column right)"],
    [{ tab: "totals", kind: "percent", dir: "columns" }, "% Total (column right)"],
    [{ tab: "totals", kind: "running", dir: "columns" }, "Running Total (column right)"],
  ],
  tables: [
    [{ tab: "tables", kind: "table" }, "Table"],
    [{ tab: "tables", kind: "pivot" }, "PivotTable"],
  ],
  sparklines: [
    [{ tab: "sparklines", kind: "line" }, "Line"],
    [{ tab: "sparklines", kind: "column" }, "Column"],
    [{ tab: "sparklines", kind: "winloss" }, "Win/Loss"],
  ],
};

export function QuickAnalysisDialog({ selection, onRun, onClose }: { selection: string; onRun: (a: QuickAction) => Promise<void>; onClose: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("formatting");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Quick Analysis" onClose={onClose}>
      <div className="w-[min(32rem,85vw)] text-sm">
        <p className="mb-2 text-slate-500">For {selection}</p>
        <div role="tablist" className="mb-3 flex gap-1 border-b border-slate-200">
          {TABS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={`-mb-px border-b-2 px-2 py-1 ${tab === k ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-600"}`} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="flex flex-wrap gap-2">
          {OPTIONS[tab].map(([action, label]) => (
            <button
              key={label}
              className="rounded border border-slate-300 px-3 py-2 text-slate-700 hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-40"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                onRun(action)
                  .then(onClose)
                  .catch((e) => setError((e as Error).message))
                  .finally(() => setBusy(false));
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {error && (
          <p className="mt-2 text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
