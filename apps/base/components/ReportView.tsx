"use client";
/**
 * Reports, as in Access: Report view shows the laid-out report, ready to print or save as PDF;
 * Design view picks the source, the fields and their totals, the group levels and the sort, with
 * a preview of the unsaved design underneath.
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { TableInfo } from "@/lib/catalog";
import type { QueryInfo } from "@/lib/queries";
import { FORMATS, GROUP_BY, MAX_GROUPS, TOTAL_LABELS, TOTALS, type Format, type GroupBy, type ReportColumnDef, type ReportData, type ReportLayout, type TotalFn } from "@/lib/reportLayout";
import type { ReportInfo, ReportSource } from "@/lib/reports";
import { ReportBody } from "./ReportBody";

export type ReportMode = "report" | "design";

const FORMAT_LABELS: Record<Format, string> = { auto: "As stored", currency: "Currency", whole: "Whole number", decimal: "Two decimals", percent: "Percent", date: "Date", text: "Text" };
const GROUP_LABELS: Record<GroupBy, string> = { value: "Each value", year: "Year", quarter: "Quarter", month: "Month", letter: "First letter" };

/** Runs the report (with an unsaved layout when given) and keeps the result. */
function useReport(id: string, layout: ReportLayout | null, key: string) {
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      api<{ report: ReportData }>(`/api/reports/${id}/run`, { body: layout ? { layout } : {} })
        .then((r) => {
          if (!live) return;
          setData(r.report);
          setError("");
        })
        .catch((e) => live && setError((e as Error).message))
        .finally(() => live && setLoading(false));
    }, layout ? 300 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // The layout is in the key; the object itself changes on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, key]);
  return { data, error, loading };
}

export function ReportView({ report }: { report: ReportInfo }) {
  const [round, setRound] = useState(0);
  const { data, error, loading } = useReport(report.id, null, `${report.updatedAt}:${round}`);
  return (
    <div className="reportview">
      <div className="toolbar">
        <button onClick={() => setRound((n) => n + 1)} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
        <span className="grow" />
        <a className="button primary" href={`/r/${report.id}`} target="_blank" rel="noreferrer">
          Print or save as PDF
        </a>
      </div>
      {error && <div className="error-bar" role="alert">{error}</div>}
      <div className="report-scroll">{data && <ReportBody data={data} landscape={report.layout.landscape} />}</div>
    </div>
  );
}

export function ReportDesign({ report, tables, queries, canEdit, onSaved }: { report: ReportInfo; tables: TableInfo[]; queries: QueryInfo[]; canEdit: boolean; onSaved: (r: ReportInfo) => void }) {
  const [layout, setLayout] = useState<ReportLayout>(report.layout);
  const [source, setSource] = useState<ReportSource>(report.source);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const sourceChanged = source.kind !== report.source.kind || source.id !== report.source.id;
  // The preview runs the saved source; a new source is previewed once saved.
  const key = JSON.stringify(layout);
  const { data, error: runError } = useReport(report.id, layout, `${report.updatedAt}:${key}`);
  const cols = useMemo(() => data?.source.map((c) => c.name) ?? [], [data]);

  useEffect(() => {
    if (!dirty) {
      setLayout(report.layout);
      setSource(report.source);
    }
  }, [report, dirty]);

  const change = (next: Partial<ReportLayout>) => {
    setLayout((l) => ({ ...l, ...next }));
    setDirty(true);
  };
  // No columns listed means every column; listing starts from that.
  const shown: ReportColumnDef[] = layout.columns.length ? layout.columns : cols.map((name) => ({ name }));
  const setCols = (next: ReportColumnDef[]) => change({ columns: next });
  const col = (name: string, patch: Partial<ReportColumnDef>) => setCols(shown.map((c) => (c.name === name ? { ...c, ...patch } : c)));
  const rows = [...shown.map((c) => c.name).filter((n) => cols.includes(n) || !data), ...cols.filter((n) => !shown.some((c) => c.name === n))];

  function move(name: string, by: number) {
    const at = shown.findIndex((c) => c.name === name);
    const to = at + by;
    if (at < 0 || to < 0 || to >= shown.length) return;
    const next = [...shown];
    [next[at], next[to]] = [next[to], next[at]];
    setCols(next);
  }

  async function save() {
    try {
      const { report: saved } = await api<{ report: ReportInfo }>(`/api/reports/${report.id}`, { method: "PATCH", body: { layout, source } });
      setDirty(false);
      onSaved(saved);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const sourceValue = `${source.kind}:${source.id}`;
  return (
    <div className="design report-design">
      {error && (
        <div className="error-bar" role="alert">
          {error} <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      <div className="props">
        <div className="prop-grid">
          <label htmlFor="rep-source">Records from</label>
          <select
            id="rep-source"
            value={sourceValue}
            disabled={!canEdit}
            onChange={(e) => {
              const [kind, id] = e.target.value.split(":");
              setSource({ kind: kind as ReportSource["kind"], id });
              // Another source has other columns.
              setLayout((l) => ({ ...l, columns: [], groups: [], sort: [] }));
              setDirty(true);
            }}
          >
            <optgroup label="Tables">
              {tables.map((t) => (
                <option key={t.id} value={`table:${t.id}`}>
                  {t.name}
                </option>
              ))}
            </optgroup>
            {queries.length > 0 && (
              <optgroup label="Queries">
                {queries.map((q) => (
                  <option key={q.id} value={`query:${q.id}`}>
                    {q.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <label htmlFor="rep-title">Title</label>
          <input id="rep-title" placeholder={report.name} value={layout.title ?? ""} disabled={!canEdit} onChange={(e) => change({ title: e.target.value || undefined })} />
          <label htmlFor="rep-land">Landscape page</label>
          <input id="rep-land" type="checkbox" checked={layout.landscape} disabled={!canEdit} onChange={(e) => change({ landscape: e.target.checked })} />
          <label htmlFor="rep-sum">Totals only (no records)</label>
          <input id="rep-sum" type="checkbox" checked={layout.summaryOnly} disabled={!canEdit} onChange={(e) => change({ summaryOnly: e.target.checked })} />
        </div>
        {sourceChanged && <p className="muted small">Save to see the new source's fields.</p>}
      </div>
      {!sourceChanged && (
        <>
          <table className="fields">
            <thead>
              <tr>
                <th>Show</th>
                <th>Field</th>
                <th>Label</th>
                <th>Format</th>
                <th>Total</th>
                <th>Order</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((name) => {
                const c = shown.find((x) => x.name === name);
                const at = shown.findIndex((x) => x.name === name);
                return (
                  <tr key={name} className={c ? "" : "off"}>
                    <td>
                      <input type="checkbox" aria-label={`Show ${name}`} checked={!!c} disabled={!canEdit} onChange={(e) => setCols(e.target.checked ? [...shown, { name }] : shown.filter((x) => x.name !== name))} />
                    </td>
                    <td>{name}</td>
                    <td>
                      <input aria-label={`Label for ${name}`} placeholder={name} value={c?.label ?? ""} disabled={!canEdit || !c} onChange={(e) => col(name, { label: e.target.value || undefined })} />
                    </td>
                    <td>
                      <select aria-label={`Format of ${name}`} value={c?.format ?? "auto"} disabled={!canEdit || !c} onChange={(e) => col(name, { format: e.target.value === "auto" ? undefined : (e.target.value as Format) })}>
                        {FORMATS.map((f) => (
                          <option key={f} value={f}>
                            {FORMAT_LABELS[f]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select aria-label={`Total of ${name}`} value={c?.total ?? ""} disabled={!canEdit || !c} onChange={(e) => col(name, { total: (e.target.value || undefined) as TotalFn | undefined })}>
                        <option value="">None</option>
                        {TOTALS.map((t) => (
                          <option key={t} value={t}>
                            {TOTAL_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="order">
                      {c && canEdit && (
                        <>
                          <button aria-label={`Move ${name} up`} onClick={() => move(name, -1)} disabled={at === 0}>
                            ↑
                          </button>
                          <button aria-label={`Move ${name} down`} onClick={() => move(name, 1)} disabled={at === shown.length - 1}>
                            ↓
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="props">
            <h3>Group levels</h3>
            {layout.groups.length === 0 && <p className="muted small">No groups: the records are listed one after another. Group them by a field to get a heading and totals for each value.</p>}
            {layout.groups.map((g, i) => (
              <div key={i} className="level-row">
                <span className="muted small">{i === 0 ? "Group by" : "then by"}</span>
                <select aria-label={`Group ${i + 1} field`} value={g.column} disabled={!canEdit} onChange={(e) => change({ groups: layout.groups.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)) })}>
                  {cols.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
                <select aria-label={`Group ${i + 1} by`} value={g.by ?? "value"} disabled={!canEdit} onChange={(e) => change({ groups: layout.groups.map((x, j) => (j === i ? { ...x, by: e.target.value === "value" ? undefined : (e.target.value as GroupBy) } : x)) })}>
                  {GROUP_BY.map((b) => (
                    <option key={b} value={b}>
                      {GROUP_LABELS[b]}
                    </option>
                  ))}
                </select>
                <select aria-label={`Group ${i + 1} order`} value={g.dir ?? "asc"} disabled={!canEdit} onChange={(e) => change({ groups: layout.groups.map((x, j) => (j === i ? { ...x, dir: e.target.value === "desc" ? "desc" : undefined } : x)) })}>
                  <option value="asc">A to Z, smallest first</option>
                  <option value="desc">Z to A, largest first</option>
                </select>
                <label className="check">
                  <input type="checkbox" checked={g.totals !== false} disabled={!canEdit} onChange={(e) => change({ groups: layout.groups.map((x, j) => (j === i ? { ...x, totals: e.target.checked ? undefined : false } : x)) })} /> Totals under each group
                </label>
                {canEdit && (
                  <button aria-label={`Remove group ${i + 1}`} onClick={() => change({ groups: layout.groups.filter((_, j) => j !== i) })}>
                    ✕
                  </button>
                )}
              </div>
            ))}
            {canEdit && layout.groups.length < MAX_GROUPS && cols.length > 0 && (
              <button onClick={() => change({ groups: [...layout.groups, { column: cols.find((n) => !layout.groups.some((g) => g.column === n)) ?? cols[0] }] })}>Add a group level</button>
            )}
            <h3 className="spaced">Sort records by</h3>
            {layout.sort.map((s, i) => (
              <div key={i} className="level-row">
                <select aria-label={`Sort ${i + 1} field`} value={s.column} disabled={!canEdit} onChange={(e) => change({ sort: layout.sort.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)) })}>
                  {cols.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
                <select aria-label={`Sort ${i + 1} order`} value={s.dir ?? "asc"} disabled={!canEdit} onChange={(e) => change({ sort: layout.sort.map((x, j) => (j === i ? { ...x, dir: e.target.value === "desc" ? "desc" : undefined } : x)) })}>
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
                {canEdit && (
                  <button aria-label={`Remove sort ${i + 1}`} onClick={() => change({ sort: layout.sort.filter((_, j) => j !== i) })}>
                    ✕
                  </button>
                )}
              </div>
            ))}
            {canEdit && cols.length > 0 && <button onClick={() => change({ sort: [...layout.sort, { column: cols[0] }] })}>Add a sort</button>}
            {canEdit && (
              <div className="actions">
                <button className="primary" onClick={save} disabled={!dirty}>
                  Save
                </button>
                <button
                  onClick={() => {
                    setLayout(report.layout);
                    setSource(report.source);
                    setDirty(false);
                  }}
                  disabled={!dirty}
                >
                  Undo changes
                </button>
              </div>
            )}
          </div>
          <h3 className="preview-head">Preview</h3>
          {(runError || (data && data.missing.length > 0)) && <p className="error small preview-note">{runError || `The source no longer has ${data!.missing.join(", ")}; those parts are left out.`}</p>}
          <div className="report-preview">{data && <ReportBody data={data} landscape={layout.landscape} />}</div>
        </>
      )}
      {sourceChanged && canEdit && (
        <div className="props">
          <div className="actions">
            <button className="primary" onClick={save}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Picks the source and name of a new report. */
export function NewReportDialog({ tables, queries, onCancel, onCreate }: { tables: TableInfo[]; queries: QueryInfo[]; onCancel: () => void; onCreate: (input: { name: string; source: ReportSource }) => Promise<void> }) {
  const options = [...tables.map((t) => ({ value: `table:${t.id}`, name: t.name })), ...queries.map((q) => ({ value: `query:${q.id}`, name: q.name }))];
  const [value, setValue] = useState(options[0]?.value ?? "");
  const [name, setName] = useState(options[0] ? `${options[0].name} report` : "");
  const [named, setNamed] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="modal-back" onMouseDown={onCancel}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          const [kind, id] = value.split(":");
          try {
            await onCreate({ name, source: { kind: kind as ReportSource["kind"], id } });
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <h3>New report</h3>
        <p className="muted small">The report lists every field of the table or query. Group it and add totals in Design view.</p>
        <div className="prop-grid">
          <label htmlFor="nr-source">Records from</label>
          <select
            id="nr-source"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (!named) setName(`${options.find((o) => o.value === e.target.value)?.name ?? ""} report`);
            }}
          >
            <optgroup label="Tables">
              {tables.map((t) => (
                <option key={t.id} value={`table:${t.id}`}>
                  {t.name}
                </option>
              ))}
            </optgroup>
            {queries.length > 0 && (
              <optgroup label="Queries">
                {queries.map((q) => (
                  <option key={q.id} value={`query:${q.id}`}>
                    {q.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <label htmlFor="nr-name">Report name</label>
          <input
            id="nr-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNamed(true);
            }}
          />
        </div>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="submit" className="primary" disabled={!value || !name.trim()}>
            Create
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
