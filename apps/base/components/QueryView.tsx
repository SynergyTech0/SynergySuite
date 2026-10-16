"use client";
/**
 * One query in its three views, as in Access: Design (tables, joins and the design grid),
 * SQL (the query as SQL, with AI help writing it), and Datasheet (the results, read only).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { TableInfo } from "@/lib/catalog";
import { designSql, linksBetween, TOTAL_LABELS, TOTALS, type JoinKind, type QueryColumn, type QueryDef, type Total } from "@/lib/designer";
import type { QueryInfo } from "@/lib/queries";
import type { QueryResult } from "@/lib/sql";
import { SheetsLink } from "./SheetsLink";

export type QueryMode = "datasheet" | "design" | "sql";

type Props = {
  databaseId: string;
  query: QueryInfo;
  tables: TableInfo[];
  canEdit: boolean;
  aiEnabled: boolean;
  mode: QueryMode;
  onMode: (m: QueryMode) => void;
  onSaved: (q: QueryInfo) => void;
};

const EMPTY: QueryDef = { tables: [], columns: [] };

export function QueryView({ databaseId, query, tables, canEdit, aiEnabled, mode, onMode, onSaved }: Props) {
  const [kind, setKind] = useState(query.kind);
  const [def, setDef] = useState<QueryDef>(query.definition ?? EMPTY);
  const [sql, setSql] = useState(query.sql);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // The SQL the design grid stands for, or why it can't be made yet.
  const designed = useMemo(() => {
    if (kind !== "design") return { sql, problem: "" };
    if (!def.tables.length) return { sql: "", problem: "Add a table to the query" };
    try {
      return { sql: designSql(def, tables), problem: "" };
    } catch (e) {
      return { sql: "", problem: (e as Error).message };
    }
  }, [kind, def, sql, tables]);

  const changeDef = (fn: (d: QueryDef) => QueryDef) => {
    setDef((d) => fn(d));
    setDirty(true);
  };

  async function save() {
    setSaving(true);
    try {
      const { query: q } = await api<{ query: QueryInfo }>(`/api/queries/${query.id}`, {
        method: "PATCH",
        body: kind === "design" ? { kind, definition: def } : { kind, sql },
      });
      onSaved(q);
      setDirty(false);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="query">
      <div className="toolbar">
        <button className="primary" onClick={() => onMode("datasheet")} disabled={mode === "datasheet"} title="Run the query and show its results">
          ▶ Run
        </button>
        {canEdit && (
          <button onClick={save} disabled={!dirty || saving}>
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        )}
        {mode === "design" && kind === "design" && (
          <>
            <label className="check">
              <input type="checkbox" checked={!!def.totals} disabled={!canEdit} onChange={(e) => changeDef((d) => ({ ...d, totals: e.target.checked }))} /> Totals
            </label>
            <label className="check">
              <input type="checkbox" checked={!!def.distinct} disabled={!canEdit} onChange={(e) => changeDef((d) => ({ ...d, distinct: e.target.checked }))} /> Unique values
            </label>
            <label className="check">
              Top{" "}
              <input
                type="number"
                min={1}
                className="top"
                placeholder="All"
                value={def.limit ?? ""}
                disabled={!canEdit}
                onChange={(e) => changeDef((d) => ({ ...d, limit: e.target.value ? Math.max(1, Math.floor(Number(e.target.value))) : undefined }))}
              />
            </label>
          </>
        )}
        <span className="grow" />
        {dirty ? (
          <span className="muted small">Save to export</span>
        ) : (
          query.sql && (
            <a className="button" href={`/api/queries/${query.id}/csv`}>
              Export CSV
            </a>
          )
        )}
        {query.sql && !dirty && <SheetsLink databaseId={databaseId} source={{ kind: "query", id: query.id }} name={query.name} canEdit={canEdit} />}
      </div>
      {error && (
        <div className="error-bar" role="alert">
          {error} <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      {mode === "design" &&
        (kind === "design" ? (
          <DesignGrid def={def} tables={tables} canEdit={canEdit} onChange={changeDef} problem={designed.problem} />
        ) : (
          <div className="query-note">
            <p>This query is written in SQL, so it has no design grid. Open SQL view to change it.</p>
            {canEdit && (
              <button
                onClick={() => {
                  if (!confirm("Start a new design for this query? Its SQL is replaced when you save.")) return;
                  setKind("design");
                  setDef(EMPTY);
                  setDirty(true);
                }}
              >
                Start a new design
              </button>
            )}
          </div>
        ))}
      {mode === "sql" && (
        <SqlEditor
          databaseId={databaseId}
          queryId={query.id}
          sql={kind === "design" ? designed.sql : sql}
          fromDesign={kind === "design"}
          canEdit={canEdit}
          aiEnabled={aiEnabled}
          onChange={(text) => {
            setKind("sql");
            setSql(text);
            setDirty(true);
          }}
          onRun={() => onMode("datasheet")}
        />
      )}
      {mode === "datasheet" && (
        <Results
          databaseId={databaseId}
          source={kind === "design" ? { kind, definition: def } : { kind, sql }}
          problem={kind === "design" ? designed.problem : sql.trim() ? "" : "Write the query in SQL view"}
        />
      )}
    </div>
  );
}

// ---- Design view ---------------------------------------------------------------------

const JOIN_LABELS = (from: string, to: string): Record<JoinKind, string> => ({
  inner: "Only records where both match",
  many: `All ${from} records, and matching ${to}`,
  one: `All ${to} records, and matching ${from}`,
});

function DesignGrid({ def, tables, canEdit, onChange, problem }: { def: QueryDef; tables: TableInfo[]; canEdit: boolean; onChange: (fn: (d: QueryDef) => QueryDef) => void; problem: string }) {
  const inQuery = def.tables.map((id) => tables.find((t) => t.id === id)).filter((t): t is TableInfo => !!t);
  const others = tables.filter((t) => !def.tables.includes(t.id));
  const links = linksBetween(tables, def.tables);
  const name = (id: string) => tables.find((t) => t.id === id)?.name ?? "?";
  const rows = Math.max(2, ...def.columns.map((c) => (c.criteria?.length ?? 0) + 1));

  const setColumn = (i: number, patch: Partial<QueryColumn>) =>
    onChange((d) => ({ ...d, columns: d.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const addColumn = (c: QueryColumn) => onChange((d) => ({ ...d, columns: [...d.columns, c] }));
  const removeColumn = (i: number) => onChange((d) => ({ ...d, columns: d.columns.filter((_, j) => j !== i) }));
  const moveColumn = (i: number, by: number) =>
    onChange((d) => {
      const cols = [...d.columns];
      const j = i + by;
      if (j < 0 || j >= cols.length) return d;
      [cols[i], cols[j]] = [cols[j], cols[i]];
      return { ...d, columns: cols };
    });
  const setCriteria = (i: number, r: number, text: string) =>
    onChange((d) => ({
      ...d,
      columns: d.columns.map((c, j) => {
        if (j !== i) return c;
        const criteria = [...(c.criteria ?? [])];
        while (criteria.length <= r) criteria.push("");
        criteria[r] = text;
        while (criteria.length && !criteria[criteria.length - 1]) criteria.pop();
        return { ...c, criteria };
      }),
    }));

  const fieldValue = (c: QueryColumn) => (c.expression !== undefined ? "expr" : `${c.table}:${c.field}`);
  const fieldOptions = (
    <>
      {inQuery.map((t) => (
        <optgroup key={t.id} label={t.name}>
          <option value={`${t.id}:*`}>{t.name}.*</option>
          {t.fields.map((f) => (
            <option key={f.id} value={`${t.id}:${f.id}`}>
              {f.name}
            </option>
          ))}
        </optgroup>
      ))}
      <option value="expr">Expression…</option>
    </>
  );
  const parseField = (v: string): QueryColumn => {
    if (v === "expr") return { expression: "", alias: "Expr" };
    const [table, field] = v.split(":");
    return { table, field };
  };

  return (
    <div className="qdesign">
      <div className="qtables">
        {inQuery.map((t) => (
          <div key={t.id} className="qtable">
            <div className="qtable-head">
              <strong>{t.name}</strong>
              {canEdit && (
                <button
                  aria-label={`Remove ${t.name} from the query`}
                  onClick={() => onChange((d) => ({ ...d, tables: d.tables.filter((x) => x !== t.id), columns: d.columns.filter((c) => c.table !== t.id) }))}
                >
                  ✕
                </button>
              )}
            </div>
            <ul>
              <li>
                <button disabled={!canEdit} onDoubleClick={() => addColumn({ table: t.id, field: "*" })} onClick={() => addColumn({ table: t.id, field: "*" })}>
                  *
                </button>
              </li>
              {t.fields.map((f) => (
                <li key={f.id}>
                  <button disabled={!canEdit} onClick={() => addColumn({ table: t.id, field: f.id })} title={`Add ${f.name} to the grid`}>
                    {f.type === "autonumber" ? "🔑 " : ""}
                    {f.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {canEdit && (
          <div className="qtable add">
            <select
              aria-label="Add a table"
              value=""
              onChange={(e) => e.target.value && onChange((d) => ({ ...d, tables: [...d.tables, e.target.value] }))}
            >
              <option value="">Add a table…</option>
              {others.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {links.length > 0 && (
        <div className="qjoins">
          {links.map((l) => {
            const labels = JOIN_LABELS(name(l.from), name(l.to));
            return (
              <label key={l.fieldId}>
                <span>
                  {name(l.from)}.{l.fieldName} → {name(l.to)}
                </span>
                <select
                  value={def.joins?.[l.fieldId] ?? "inner"}
                  disabled={!canEdit}
                  onChange={(e) => onChange((d) => ({ ...d, joins: { ...d.joins, [l.fieldId]: e.target.value as JoinKind } }))}
                >
                  {(Object.keys(labels) as JoinKind[]).map((k) => (
                    <option key={k} value={k}>
                      {labels[k]}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      )}
      {problem && def.tables.length > 0 && <p className="muted small qproblem">{problem}</p>}
      <div className="grid-wrap">
        <table className="qgrid">
          <tbody>
            <tr>
              <th>Field</th>
              {def.columns.map((c, i) => (
                <td key={i}>
                  <div className="qcol-head">
                    <select aria-label={`Column ${i + 1} field`} value={fieldValue(c)} disabled={!canEdit} onChange={(e) => setColumn(i, { table: undefined, field: undefined, expression: undefined, alias: undefined, ...parseField(e.target.value) })}>
                      {fieldOptions}
                    </select>
                    {canEdit && (
                      <span className="qcol-actions">
                        <button aria-label="Move left" onClick={() => moveColumn(i, -1)}>
                          ‹
                        </button>
                        <button aria-label="Move right" onClick={() => moveColumn(i, 1)}>
                          ›
                        </button>
                        <button aria-label={`Remove column ${i + 1}`} onClick={() => removeColumn(i)}>
                          ✕
                        </button>
                      </span>
                    )}
                  </div>
                  {c.expression !== undefined && (
                    <>
                      <input aria-label="Column name" placeholder="Name" value={c.alias ?? ""} disabled={!canEdit} onChange={(e) => setColumn(i, { alias: e.target.value })} />
                      <input aria-label="Expression" placeholder="[Price] * [Quantity]" value={c.expression} disabled={!canEdit} onChange={(e) => setColumn(i, { expression: e.target.value })} />
                    </>
                  )}
                </td>
              ))}
              <td className="qnew">
                {canEdit && inQuery.length > 0 && (
                  <select aria-label="Add a field" value="" onChange={(e) => e.target.value && addColumn(parseField(e.target.value))}>
                    <option value="">Add a field…</option>
                    {fieldOptions}
                  </select>
                )}
              </td>
            </tr>
            <tr>
              <th>Table</th>
              {def.columns.map((c, i) => (
                <td key={i} className="muted">
                  {c.table ? name(c.table) : ""}
                </td>
              ))}
              <td />
            </tr>
            {def.totals && (
              <tr>
                <th>Total</th>
                {def.columns.map((c, i) => (
                  <td key={i}>
                    <select aria-label={`Column ${i + 1} total`} value={c.total ?? "group"} disabled={!canEdit} onChange={(e) => setColumn(i, { total: e.target.value as Total })}>
                      {TOTALS.map((t) => (
                        <option key={t} value={t}>
                          {TOTAL_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
                <td />
              </tr>
            )}
            <tr>
              <th>Sort</th>
              {def.columns.map((c, i) => (
                <td key={i}>
                  <select aria-label={`Column ${i + 1} sort`} value={c.sort ?? ""} disabled={!canEdit} onChange={(e) => setColumn(i, { sort: (e.target.value || undefined) as QueryColumn["sort"] })}>
                    <option value="">(not sorted)</option>
                    <option value="asc">Ascending</option>
                    <option value="desc">Descending</option>
                  </select>
                </td>
              ))}
              <td />
            </tr>
            <tr>
              <th>Show</th>
              {def.columns.map((c, i) => (
                <td key={i} className="center">
                  <input type="checkbox" aria-label={`Show column ${i + 1}`} checked={c.show !== false} disabled={!canEdit} onChange={(e) => setColumn(i, { show: e.target.checked ? undefined : false })} />
                </td>
              ))}
              <td />
            </tr>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={`c${r}`}>
                <th>{r === 0 ? "Criteria" : "or"}</th>
                {def.columns.map((c, i) => (
                  <td key={i}>
                    <input aria-label={`Column ${i + 1} criteria ${r + 1}`} value={c.criteria?.[r] ?? ""} disabled={!canEdit} onChange={(e) => setCriteria(i, r, e.target.value)} />
                  </td>
                ))}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Criteria as in Access: <code>&gt;100</code>, <code>&quot;Leeds&quot;</code>, <code>Like &quot;S*&quot;</code>, <code>Between #1/1/2026# And #3/31/2026#</code>, <code>Is Null</code>,{" "}
        <code>In (&quot;a&quot;, &quot;b&quot;)</code>, <code>&lt;Date()</code>. Criteria on one row must all match; each “or” row is an alternative.
      </p>
    </div>
  );
}

// ---- SQL view ------------------------------------------------------------------------

function SqlEditor({ databaseId, queryId, sql, fromDesign, canEdit, aiEnabled, onChange, onRun }: {
  databaseId: string;
  queryId: string;
  sql: string;
  fromDesign: boolean;
  canEdit: boolean;
  aiEnabled: boolean;
  onChange: (sql: string) => void;
  onRun: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<{ explanation?: string; error?: string } | null>(null);

  async function ask() {
    if (!question.trim()) return;
    setAsking(true);
    setAnswer(null);
    try {
      const r = await api<{ sql: string; explanation: string }>(`/api/databases/${databaseId}/ask`, { body: { question, sql, queryId } });
      onChange(r.sql);
      setAnswer({ explanation: r.explanation });
    } catch (e) {
      setAnswer({ error: (e as Error).message });
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="sqlview">
      {aiEnabled && canEdit && (
        <form
          className="ask"
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <input
            aria-label="Ask for a query"
            placeholder="Ask for a query, e.g. total sales by customer this year"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button className="primary" disabled={asking || !question.trim()}>
            {asking ? "Writing…" : "Ask AI"}
          </button>
        </form>
      )}
      {answer?.explanation && (
        <p className="ai-note">
          {answer.explanation}{" "}
          <button onClick={onRun}>Run it</button>
        </p>
      )}
      {answer?.error && <p className="error">{answer.error}</p>}
      {fromDesign && canEdit && <p className="muted small">This SQL comes from the design grid. Editing it here turns the query into a SQL query.</p>}
      <textarea
        aria-label="SQL"
        spellCheck={false}
        value={sql}
        readOnly={!canEdit}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") onRun();
        }}
        placeholder={'SELECT "Name", "City" FROM "Customers" ORDER BY "Name"'}
      />
      <p className="muted small">
        One SELECT over this database&apos;s tables and saved queries, by name (<code>&quot;Order Date&quot;</code> or <code>[Order Date]</code>). Queries only read data. Ctrl+Enter runs it.
      </p>
    </div>
  );
}

// ---- Datasheet view (results) ----------------------------------------------------------

function cell(v: unknown, kind: QueryResult["columns"][number]["kind"]): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (kind === "yesno" || typeof v === "boolean") return v ? "✓" : "";
  if (kind === "datetime" && typeof v === "string" && !Number.isNaN(Date.parse(v))) return new Date(v).toLocaleString();
  if (typeof v === "object") return JSON.stringify(v);
  // Currency comes back with four decimals (290.0000); show at least two, and no padding beyond.
  if (kind === "number" && typeof v === "string" && /^-?\d+\.\d+$/.test(v)) return v.replace(/(\.\d\d\d*?)0+$/, "$1");
  return String(v);
}

function Results({ databaseId, source, problem }: { databaseId: string; source: { kind: string; sql?: string; definition?: QueryDef }; problem: string }) {
  const [result, setResult] = useState<(QueryResult & { sql: string }) | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const key = JSON.stringify(source);

  const run = useCallback(async () => {
    if (problem) return;
    setLoading(true);
    try {
      setResult(await api(`/api/databases/${databaseId}/run`, { body: JSON.parse(key) }));
      setError("");
    } catch (e) {
      setResult(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [databaseId, key, problem]);

  useEffect(() => {
    void run();
  }, [run]);

  if (problem) return <p className="empty-note">{problem} in Design view.</p>;
  return (
    <div className="datasheet">
      {error && <div className="error-bar" role="alert">{error}</div>}
      {result && (
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                {result.columns.map((c, i) => (
                  <th key={i} className={c.kind === "number" ? "num" : ""}>
                    <span className="head">{c.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((v, j) => (
                    <td key={j} className={result.columns[j].kind === "number" ? "num" : result.columns[j].kind === "yesno" ? "center" : ""}>
                      {cell(v, result.columns[j].kind)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {result.rows.length === 0 && <p className="empty-note">No records match.</p>}
        </div>
      )}
      <div className="navigator">
        {result && (
          <span>
            {result.rows.length.toLocaleString("en-US")} record{result.rows.length === 1 ? "" : "s"}
            {result.truncated ? " shown (the first 1,000; export to get them all)" : ""} · {result.ms} ms
          </span>
        )}
        {loading && <span className="muted">Running…</span>}
        <button onClick={run} disabled={loading}>
          Refresh
        </button>
      </div>
    </div>
  );
}
