"use client";

// Get data (Power Query style): pick a source, shape it, load it into the sheet;
// and the list of the workbook's queries, to refresh or remove them.
import { useMemo, useRef, useState } from "react";
import { Modal } from "./SheetDialogs";
import { columnNames, detectFormat, gridFor, parseHtmlTables, rawGrid, shape, type Format, type QueryDef, type QuerySteps } from "@/lib/data-import";
import { checkExpression, describeTransform, type Aggregate, type FilterOp, type Transform } from "@/lib/query-transforms";

const button = "text-sm rounded-full px-4 py-1.5";
const primary = `${button} bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40`;
const plain = `${button} hover:bg-slate-100 text-slate-700 disabled:opacity-40`;
const input = "w-full rounded border border-slate-300 px-2 py-1 text-sm";

type Loaded = { text: string; format: Format; source: QueryDef["source"]; name: string };

export type GetDataResult = { name: string; source: QueryDef["source"]; steps: QuerySteps; destination: { kind: "new" } | { kind: "cell"; text: string } };

const baseName = (s: string) => {
  const last = s.replace(/[?#].*$/, "").split(/[\\/]/).filter(Boolean).pop() || s;
  return last.replace(/\.[a-z0-9]+$/i, "").slice(0, 60) || "Query";
};

export function GetDataDialog({
  anchor,
  canEdit,
  onFetch,
  onLoad,
  onClose,
}: {
  /** The selected cell, offered as the destination. */
  anchor: string;
  canEdit: boolean;
  onFetch: (url: string) => Promise<{ text: string; contentType: string; url: string }>;
  onLoad: (v: GetDataResult, text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"web" | "file">("web");
  const [url, setUrl] = useState("https://");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [steps, setSteps] = useState<QuerySteps>({ headers: true, delimiter: "auto", removeEmptyRows: true, table: 1, jsonPath: "", skipRows: 0, columns: [] });
  const [name, setName] = useState("");
  const [dest, setDest] = useState<"new" | "cell">("new");
  const [cell, setCell] = useState(anchor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError((e as Error).message || String(e));
    } finally {
      setBusy(false);
    }
  };
  const take = (l: Loaded) => {
    setLoaded(l);
    setName(l.name);
    setSteps((s) => ({ ...s, columns: [] }));
  };

  const view = useMemo(() => {
    if (!loaded) return null;
    try {
      const raw = rawGrid(loaded.text, loaded.format, { ...steps, columns: [] });
      const all = columnNames(raw, steps);
      const grid = gridFor(loaded.text, loaded.format, steps);
      // Column names after the applied steps, for the next one.
      const after = steps.headers ? (grid[0] || []).map(String) : (grid[0] || []).map((_, j) => `Column${j + 1}`);
      const tables = loaded.format === "html" ? parseHtmlTables(loaded.text).map((t, i) => t.caption || `Table ${i + 1} (${t.grid.length} rows)`) : [];
      return { all, grid, tables, after, error: null as string | null };
    } catch (e) {
      // A step that no longer fits: name the columns before the steps so it can be removed.
      let after: string[] = [];
      try {
        const g = shape(rawGrid(loaded.text, loaded.format, steps), steps);
        after = steps.headers ? (g[0] || []).map(String) : (g[0] || []).map((_, j) => `Column${j + 1}`);
      } catch {
        /* the source itself doesn't parse */
      }
      return { all: [] as string[], grid: [] as unknown[][], tables: [] as string[], after, error: (e as Error).message };
    }
  }, [loaded, steps]);

  const chosen = steps.columns?.length ? steps.columns : view?.all || [];
  const toggleColumn = (c: string, on: boolean) => {
    const all = view?.all || [];
    const now = new Set(chosen.map((x) => x.toLowerCase()));
    if (on) now.add(c.toLowerCase());
    else now.delete(c.toLowerCase());
    const next = all.filter((x) => now.has(x.toLowerCase()));
    setSteps({ ...steps, columns: next.length === all.length ? [] : next });
  };

  return (
    <Modal title="Get data" onClose={busy ? () => {} : onClose}>
      <div className="w-[min(40rem,85vw)] space-y-3">
        <div className="flex gap-2" role="tablist">
          {(["web", "file"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`rounded border px-3 py-1 text-sm ${tab === t ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-300 text-slate-700"}`} onClick={() => setTab(t)}>
              {t === "web" ? "From web" : "From file"}
            </button>
          ))}
        </div>
        {tab === "web" ? (
          <div className="flex gap-2">
            <input className={input} value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Web address" placeholder="https://example.com/data.csv" />
            <button
              className={plain}
              disabled={busy || !/^https?:\/\/./i.test(url.trim())}
              onClick={() =>
                run(async () => {
                  const got = await onFetch(url.trim());
                  take({ text: got.text, format: detectFormat(got.contentType, got.url, got.text), source: { kind: "web", url: url.trim(), format: "csv" }, name: baseName(got.url) });
                })
              }
            >
              {busy ? "Loading…" : "Load"}
            </button>
          </div>
        ) : (
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,.json,.html,.htm,text/csv,application/json,text/html"
            aria-label="Data file"
            className="text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              void run(async () => {
                const text = await f.text();
                take({ text, format: detectFormat(f.type, f.name, text), source: { kind: "file", fileName: f.name, format: "csv" }, name: baseName(f.name) });
              });
            }}
          />
        )}

        {loaded && view && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm text-slate-700">
                Format
                <select className={input} value={loaded.format} onChange={(e) => setLoaded({ ...loaded, format: e.target.value as Format })} aria-label="Format">
                  <option value="csv">CSV / text</option>
                  <option value="json">JSON</option>
                  <option value="html">HTML table</option>
                </select>
              </label>
              {loaded.format === "csv" && (
                <label className="block text-sm text-slate-700">
                  Delimiter
                  <select className={input} value={steps.delimiter || "auto"} onChange={(e) => setSteps({ ...steps, delimiter: e.target.value as QuerySteps["delimiter"] })} aria-label="Delimiter">
                    <option value="auto">Detect</option>
                    <option value=",">Comma</option>
                    <option value=";">Semicolon</option>
                    <option value={"\t"}>Tab</option>
                    <option value="|">Pipe</option>
                  </select>
                </label>
              )}
              {loaded.format === "json" && (
                <label className="block text-sm text-slate-700">
                  List at (path)
                  <input className={input} value={steps.jsonPath || ""} onChange={(e) => setSteps({ ...steps, jsonPath: e.target.value, columns: [] })} aria-label="JSON path" placeholder="data.items" />
                </label>
              )}
              {loaded.format === "html" && (
                <label className="block text-sm text-slate-700">
                  Table
                  <select className={input} value={steps.table || 1} onChange={(e) => setSteps({ ...steps, table: Number(e.target.value), columns: [] })} aria-label="Table">
                    {view.tables.map((t, i) => (
                      <option key={i} value={i + 1}>
                        {i + 1}. {t}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block text-sm text-slate-700">
                Skip rows at the top
                <input className={input} type="number" min={0} value={steps.skipRows || 0} onChange={(e) => setSteps({ ...steps, skipRows: Math.max(0, Number(e.target.value) || 0), columns: [] })} aria-label="Skip rows" />
              </label>
            </div>
            <div className="flex gap-4 text-sm text-slate-700">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={steps.headers} onChange={(e) => setSteps({ ...steps, headers: e.target.checked, columns: [] })} />
                First row has headers
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={!!steps.removeEmptyRows} onChange={(e) => setSteps({ ...steps, removeEmptyRows: e.target.checked })} />
                Remove empty rows
              </label>
            </div>
            {view.all.length > 0 && (
              <fieldset className="text-sm text-slate-700">
                <legend className="mb-1">Columns</legend>
                <div className="flex flex-wrap gap-x-3 gap-y-1 max-h-20 overflow-auto">
                  {view.all.map((c) => (
                    <label key={c} className="flex items-center gap-1">
                      <input type="checkbox" checked={chosen.some((x) => x.toLowerCase() === c.toLowerCase())} onChange={(e) => toggleColumn(c, e.target.checked)} aria-label={`Keep column ${c}`} />
                      {c}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <AppliedSteps steps={steps.transforms || []} names={view.after} onChange={(transforms) => setSteps({ ...steps, transforms })} />
            {view.error ? (
              <p className="text-sm text-red-600" role="alert">
                {view.error}
              </p>
            ) : (
              <div className="max-h-48 overflow-auto border border-slate-200 rounded">
                <table className="text-xs w-full" aria-label="Preview">
                  <tbody>
                    {view.grid.slice(0, 8).map((r, i) => (
                      <tr key={i} className={i === 0 && steps.headers ? "font-semibold bg-slate-50" : ""}>
                        {r.map((v, j) => (
                          <td key={j} className="border-b border-slate-100 px-2 py-0.5 whitespace-nowrap">
                            {v == null ? "" : String(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-xs text-slate-500 px-2 py-1">{Math.max(0, view.grid.length - (steps.headers ? 1 : 0))} rows</div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm text-slate-700">
                Query name
                <input className={input} value={name} onChange={(e) => setName(e.target.value)} aria-label="Query name" />
              </label>
              <div className="text-sm text-slate-700">
                Load to
                <div className="flex items-center gap-2 mt-1">
                  <label className="flex items-center gap-1">
                    <input type="radio" name="get-data-dest" checked={dest === "new"} onChange={() => setDest("new")} />
                    New sheet
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" name="get-data-dest" checked={dest === "cell"} onChange={() => setDest("cell")} />
                    At
                  </label>
                  <input className={`${input} !w-20`} value={cell} onChange={(e) => setCell(e.target.value)} disabled={dest !== "cell"} aria-label="Destination cell" />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button className={plain} onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className={primary}
          disabled={busy || !canEdit || !loaded || !!view?.error || !name.trim()}
          onClick={() =>
            run(async () => {
              await onLoad({ name: name.trim(), source: { ...loaded!.source, format: loaded!.format }, steps, destination: dest === "new" ? { kind: "new" } : { kind: "cell", text: cell } }, loaded!.text);
              onClose();
            })
          }
        >
          Load
        </button>
      </div>
    </Modal>
  );
}

export function QueriesDialog({
  queries,
  canEdit,
  sheetName,
  onRefresh,
  onDelete,
  onClose,
}: {
  queries: QueryDef[];
  canEdit: boolean;
  sheetName: (id: string) => string;
  onRefresh: (q: QueryDef, fileText?: string) => Promise<void>;
  onDelete: (q: QueryDef) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileFor = useRef<QueryDef | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const run = async (id: string, f: () => Promise<void>, done?: string) => {
    setBusy(id);
    setMessage(null);
    try {
      await f();
      if (done) setMessage(done);
    } catch (e) {
      setMessage((e as Error).message || String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal title="Queries and connections" onClose={busy ? () => {} : onClose}>
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        aria-label="Refresh from file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          const q = fileFor.current;
          e.target.value = "";
          if (!f || !q) return;
          void run(q.id, async () => onRefresh(q, await f.text()), `${q.name} refreshed.`);
        }}
      />
      <div className="w-[min(36rem,85vw)]">
        {queries.length === 0 ? (
          <p className="text-sm text-slate-500">This workbook has no queries. Use Data &gt; Get data… to add one.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm" aria-label="Queries">
            {queries.map((q) => (
              <li key={q.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-slate-800 truncate">{q.name}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {q.foreign ? "Connection from another program (kept, not refreshed here)" : q.source.kind === "web" ? q.source.url : q.source.fileName}
                    {q.sheetId && !q.foreign ? ` → ${sheetName(q.sheetId)}` : ""}
                    {q.size ? ` · ${Math.max(0, q.size.rows - (q.steps.headers ? 1 : 0))} rows` : ""}
                    {q.refreshedAt ? ` · refreshed ${new Date(q.refreshedAt).toLocaleString()}` : ""}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {!q.foreign && (
                    <button
                      className={plain}
                      disabled={!!busy || !canEdit}
                      aria-label={`Refresh ${q.name}`}
                      onClick={() => {
                        if (q.source.kind === "file") {
                          fileFor.current = q;
                          fileRef.current?.click();
                        } else void run(q.id, () => onRefresh(q), `${q.name} refreshed.`);
                      }}
                    >
                      {busy === q.id ? "Refreshing…" : "Refresh"}
                    </button>
                  )}
                  <button className={plain} disabled={!!busy || !canEdit} aria-label={`Delete ${q.name}`} onClick={() => void run(q.id, () => onDelete(q))}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {message && (
          <p className="mt-2 text-sm text-slate-700" role="status">
            {message}
          </p>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <button className={primary} onClick={onClose} disabled={!!busy}>
          Close
        </button>
      </div>
    </Modal>
  );
}

type StepKind = Transform["kind"];
const STEP_KINDS: [StepKind, string][] = [
  ["filter", "Filter rows"],
  ["sort", "Sort"],
  ["rename", "Rename column"],
  ["remove", "Remove column"],
  ["type", "Change type"],
  ["replace", "Replace values"],
  ["text", "Format text"],
  ["split", "Split column"],
  ["merge", "Merge columns"],
  ["custom", "Custom column"],
  ["fill down", "Fill down"],
  ["distinct", "Remove duplicates"],
  ["top", "Keep first rows"],
  ["group", "Group by"],
  ["unpivot", "Unpivot other columns"],
];
const FILTER_OPS: FilterOp[] = ["=", "<>", ">", ">=", "<", "<=", "contains", "not contains", "begins with", "ends with", "is empty", "is not empty"];
const AGGREGATES: Aggregate[] = ["sum", "count", "average", "min", "max", "count distinct"];
type StepDraft = { kind: StepKind; column: string; other: string; op: FilterOp; value: string; to: string; find: string; with: string; as: string; expression: string; count: number; aggregate: Aggregate; descending: boolean; textOp: "trim" | "upper" | "lower" | "proper"; typeTo: "number" | "text" | "date" | "logical" };

function stepOf(d: StepDraft, names: string[]): Transform | string {
  const column = d.column || names[0] || "";
  switch (d.kind) {
    case "filter":
      return { kind: "filter", column, op: d.op, ...(d.op.startsWith("is ") ? {} : { value: d.value }) };
    case "sort":
      return { kind: "sort", column, descending: d.descending };
    case "rename":
      return d.to.trim() ? { kind: "rename", column, to: d.to.trim() } : "Give the column a new name.";
    case "remove":
      return { kind: "remove", column };
    case "type":
      return { kind: "type", column, to: d.typeTo };
    case "replace":
      return { kind: "replace", column, find: d.find, with: d.with };
    case "text":
      return { kind: "text", column, op: d.textOp };
    case "split":
      return d.value ? { kind: "split", column, delimiter: d.value } : "Say what to split on.";
    case "merge": {
      const other = d.other || names.find((n) => n !== column) || "";
      return other && other !== column ? { kind: "merge", columns: [column, other], separator: d.value, as: d.as.trim() || "Merged" } : "Choose two different columns.";
    }
    case "custom": {
      const problem = checkExpression(d.expression, names);
      return d.expression.trim() && !problem ? { kind: "custom", as: d.as.trim() || "Custom", expression: d.expression } : problem || "Write the column's formula, such as [Price] * [Qty].";
    }
    case "fill down":
      return { kind: "fill down", column };
    case "distinct":
      return { kind: "distinct" };
    case "top":
      return { kind: "top", count: Math.max(0, d.count) };
    case "group":
      return { kind: "group", by: [column], aggregate: d.aggregate, ...(d.aggregate === "count" ? {} : { column: d.other || names.find((n) => n !== column) || column }), as: d.as.trim() || (d.aggregate === "count" ? "Count" : `${d.aggregate[0].toUpperCase()}${d.aggregate.slice(1)}`) };
    case "unpivot":
      return { kind: "unpivot", keep: [column] };
  }
}

/** Get data's Applied steps: the list, each removable, and a row to add one. */
export function AppliedSteps({ steps, names, onChange }: { steps: Transform[]; names: string[]; onChange: (steps: Transform[]) => void }) {
  const [d, setD] = useState<StepDraft>({ kind: "filter", column: "", other: "", op: "=", value: "", to: "", find: "", with: "", as: "", expression: "", count: 10, aggregate: "sum", descending: false, textOp: "trim", typeTo: "number" });
  const [problem, setProblem] = useState<string | null>(null);
  const set = (p: Partial<StepDraft>) => {
    setD({ ...d, ...p });
    setProblem(null);
  };
  const needsColumn = !["custom", "distinct", "top"].includes(d.kind);
  const columnPick = (label: string, value: string, onPick: (v: string) => void) => (
    <select className={`${input} !w-auto`} aria-label={label} value={value || names[0] || ""} onChange={(e) => onPick(e.target.value)}>
      {names.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
  const field = (label: string, value: string, onValue: (v: string) => void, w = "!w-28") => <input className={`${input} ${w}`} aria-label={label} placeholder={label} value={value} onChange={(e) => onValue(e.target.value)} />;
  return (
    <fieldset className="text-sm text-slate-700">
      <legend className="mb-1">Applied steps</legend>
      {steps.length > 0 && (
        <ol className="mb-2 space-y-0.5" aria-label="Applied steps">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-0.5" data-step={s.kind}>
              <span className="truncate">
                {i + 1}. {describeTransform(s)}
              </span>
              <button type="button" className="text-xs text-slate-500 hover:text-red-600" aria-label={`Remove step ${i + 1}`} onClick={() => onChange(steps.filter((_, j) => j !== i))}>
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <select className={`${input} !w-auto`} aria-label="Step" value={d.kind} onChange={(e) => set({ kind: e.target.value as StepKind })}>
          {STEP_KINDS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        {needsColumn && columnPick(d.kind === "group" ? "Group by column" : d.kind === "unpivot" ? "Keep column" : "Step column", d.column, (v) => set({ column: v }))}
        {d.kind === "filter" && (
          <>
            <select className={`${input} !w-auto`} aria-label="Condition" value={d.op} onChange={(e) => set({ op: e.target.value as FilterOp })}>
              {FILTER_OPS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            {!d.op.startsWith("is ") && field("Value", d.value, (v) => set({ value: v }))}
          </>
        )}
        {d.kind === "sort" && (
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={d.descending} onChange={(e) => set({ descending: e.target.checked })} /> Descending
          </label>
        )}
        {d.kind === "rename" && field("New name", d.to, (v) => set({ to: v }))}
        {d.kind === "type" && (
          <select className={`${input} !w-auto`} aria-label="Type" value={d.typeTo} onChange={(e) => set({ typeTo: e.target.value as StepDraft["typeTo"] })}>
            <option value="number">Number</option>
            <option value="text">Text</option>
            <option value="date">Date</option>
            <option value="logical">True/False</option>
          </select>
        )}
        {d.kind === "replace" && (
          <>
            {field("Find", d.find, (v) => set({ find: v }))}
            {field("Replace with", d.with, (v) => set({ with: v }))}
          </>
        )}
        {d.kind === "text" && (
          <select className={`${input} !w-auto`} aria-label="Format" value={d.textOp} onChange={(e) => set({ textOp: e.target.value as StepDraft["textOp"] })}>
            <option value="trim">Trim</option>
            <option value="upper">UPPERCASE</option>
            <option value="lower">lowercase</option>
            <option value="proper">Capitalize Each Word</option>
          </select>
        )}
        {d.kind === "split" && field("Delimiter", d.value, (v) => set({ value: v }), "!w-20")}
        {d.kind === "merge" && (
          <>
            {columnPick("With column", d.other, (v) => set({ other: v }))}
            {field("Separator", d.value, (v) => set({ value: v }), "!w-20")}
            {field("New column name", d.as, (v) => set({ as: v }))}
          </>
        )}
        {d.kind === "custom" && (
          <>
            {field("New column name", d.as, (v) => set({ as: v }))}
            {field("Formula", d.expression, (v) => set({ expression: v }), "!w-56")}
          </>
        )}
        {d.kind === "top" && <input className={`${input} !w-20`} type="number" min={0} aria-label="Rows" value={d.count} onChange={(e) => set({ count: Number(e.target.value) || 0 })} />}
        {d.kind === "group" && (
          <>
            <select className={`${input} !w-auto`} aria-label="Aggregate" value={d.aggregate} onChange={(e) => set({ aggregate: e.target.value as Aggregate })}>
              {AGGREGATES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            {d.aggregate !== "count" && columnPick("Of column", d.other, (v) => set({ other: v }))}
            {field("New column name", d.as, (v) => set({ as: v }))}
          </>
        )}
        <button
          type="button"
          className={plain}
          disabled={!names.length}
          onClick={() => {
            const s = stepOf(d, names);
            if (typeof s === "string") setProblem(s);
            else {
              onChange([...steps, s]);
              setD({ ...d, value: "", to: "", find: "", with: "", as: "", expression: "" });
            }
          }}
        >
          Add step
        </button>
      </div>
      {problem && (
        <p className="mt-1 text-xs text-red-600" role="alert">
          {problem}
        </p>
      )}
    </fieldset>
  );
}
