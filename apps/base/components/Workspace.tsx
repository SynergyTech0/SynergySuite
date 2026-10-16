"use client";
/**
 * One open database: the navigation pane of its objects on the left (tables, queries, forms and
 * reports) and the open objects as tabs on the right, each in Datasheet, Form, Report or Design
 * view (and SQL view for queries), as in Access.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { summary, uploadAccess } from "@/lib/accessUpload";
import type { DatabaseInfo, TableInfo } from "@/lib/catalog";
import { Datasheet } from "./Datasheet";
import type { FormInfo } from "@/lib/forms";
import type { QueryInfo } from "@/lib/queries";
import { Design } from "./Design";
import { FormDesign, FormView, NewFormDialog, type FormMode } from "./FormView";
import type { ReportInfo, ReportSource } from "@/lib/reports";
import { NewReportDialog, ReportDesign, ReportView, type ReportMode } from "./ReportView";
import { QueryView, type QueryMode } from "./QueryView";
import { ListViews, type ListMode } from "./ListViews";
import { Relationships } from "./Relationships";
import { ShareDialog } from "./ShareDialog";

/** The tab id of the relationships diagram (table ids are lowercase letters and digits). */
const REL = "#relationships";

type View = QueryMode | FormMode | ReportMode | ListMode;

export function Workspace({
  database: initialDb,
  tables: initialTables,
  queries: initialQueries,
  forms: initialForms,
  reports: initialReports,
  me,
  initialTable,
}: {
  database: DatabaseInfo;
  tables: TableInfo[];
  queries: QueryInfo[];
  forms: FormInfo[];
  reports: ReportInfo[];
  me: string;
  /** The table to open first (a deep link); the first table when absent or unknown. */
  initialTable?: string;
}) {
  const [database, setDatabase] = useState(initialDb);
  const [tables, setTables] = useState(initialTables);
  const [queries, setQueries] = useState(initialQueries);
  const [forms, setForms] = useState(initialForms);
  const [newForm, setNewForm] = useState(false);
  const [reports, setReports] = useState(initialReports);
  const [newReport, setNewReport] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const first = initialTables.find((t) => t.id === initialTable) ?? initialTables[0];
  const [open, setOpen] = useState<string[]>(first ? [first.id] : []);
  const [active, setActive] = useState<string | null>(first?.id ?? null);
  const [views, setViews] = useState<Record<string, View>>({});
  const [filterText, setFilterText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const accessRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<{ title: string; notes: string[] } | null>(null);
  const canEdit = database.role !== "viewer";

  useEffect(() => {
    // What an import from the start page brought in, carried over the page change.
    try {
      const key = `base-import-${initialDb.id}`;
      const saved = sessionStorage.getItem(key);
      if (saved) {
        sessionStorage.removeItem(key);
        setNotice(JSON.parse(saved));
      }
    } catch {
      // Storage unavailable: nothing to show.
    }
  }, [initialDb.id]);

  async function importAccess(file: File) {
    setBusy(`Importing ${file.name}…`);
    try {
      const r = await uploadAccess(`/api/databases/${database.id}/access`, file);
      setBusy("");
      if (!r) return;
      await refresh();
      if (r.tables[0]) openTable(r.tables[0].id);
      setNotice({ title: summary(r), notes: r.notes });
      setError("");
    } catch (e) {
      setBusy("");
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    api<{ enabled: boolean }>(`/api/databases/${initialDb.id}/ask`)
      .then((r) => setAiEnabled(r.enabled))
      .catch(() => setAiEnabled(false));
  }, [initialDb.id]);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ database: DatabaseInfo; tables: TableInfo[]; queries: QueryInfo[]; forms: FormInfo[]; reports: ReportInfo[] }>(`/api/databases/${database.id}`);
      setDatabase(data.database);
      setTables(data.tables);
      setQueries(data.queries);
      setForms(data.forms);
      setReports(data.reports);
      setOpen((prev) => prev.filter((id) => id === REL || [...data.tables, ...data.queries, ...data.forms, ...data.reports].some((x) => x.id === id)));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [database.id]);

  function openTable(id: string) {
    setOpen((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActive(id);
  }

  function closeTab(id: string) {
    const next = open.filter((x) => x !== id);
    setOpen(next);
    if (active === id) setActive(next[next.length - 1] ?? null);
  }

  async function newTable() {
    const name = prompt("Table name", `Table${tables.length + 1}`);
    if (!name) return;
    try {
      const { table } = await api<{ table: TableInfo }>(`/api/databases/${database.id}/tables`, { body: { name } });
      setTables((prev) => [...prev, table]);
      openTable(table.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function importCsv(file: File) {
    setBusy(`Importing ${file.name}…`);
    try {
      const csv = await file.text();
      const name = file.name.replace(/\.(csv|txt|tsv)$/i, "");
      const { table, imported } = await api<{ table: TableInfo; imported: number }>(`/api/databases/${database.id}/import`, { body: { name, csv } });
      setTables((prev) => [...prev, table]);
      openTable(table.id);
      setError("");
      setBusy(`Imported ${imported.toLocaleString("en-US")} records into ${table.name}.`);
      setTimeout(() => setBusy(""), 4000);
    } catch (e) {
      setBusy("");
      setError((e as Error).message);
    }
  }

  async function renameTable(t: TableInfo) {
    const name = prompt("Table name", t.name);
    if (!name || name === t.name) return;
    try {
      await api(`/api/tables/${t.id}`, { method: "PATCH", body: { name } });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function deleteTable(t: TableInfo) {
    if (!confirm(`Delete the table "${t.name}" and all of its records? This can't be undone.`)) return;
    try {
      await api(`/api/tables/${t.id}`, { method: "DELETE" });
      // The table's forms go with it.
      const gone = new Set([t.id, ...forms.filter((f) => f.tableId === t.id).map((f) => f.id)]);
      const next = open.filter((x) => !gone.has(x));
      setOpen(next);
      if (active && gone.has(active)) setActive(next[next.length - 1] ?? null);
      setTables((prev) => prev.filter((x) => x.id !== t.id));
      setForms((prev) => prev.filter((f) => f.tableId !== t.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function newQuery() {
    const name = prompt("Query name", `Query${queries.length + 1}`);
    if (!name) return;
    try {
      const { query } = await api<{ query: QueryInfo }>(`/api/databases/${database.id}/queries`, { body: { name, kind: "design" } });
      setQueries((prev) => [...prev, query]);
      setViews((v) => ({ ...v, [query.id]: "design" }));
      openTable(query.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function renameQuery(q: QueryInfo) {
    const name = prompt("Query name", q.name);
    if (!name || name === q.name) return;
    try {
      const { query } = await api<{ query: QueryInfo }>(`/api/queries/${q.id}`, { method: "PATCH", body: { name } });
      setQueries((prev) => prev.map((x) => (x.id === q.id ? query : x)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function deleteQuery(q: QueryInfo) {
    if (!confirm(`Delete the query "${q.name}"? The data it reads stays.`)) return;
    try {
      await api(`/api/queries/${q.id}`, { method: "DELETE" });
      closeTab(q.id);
      setQueries((prev) => prev.filter((x) => x.id !== q.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function createForm(input: { tableId: string; name: string }) {
    const { form } = await api<{ form: FormInfo }>(`/api/databases/${database.id}/forms`, { body: input });
    setForms((prev) => [...prev, form]);
    setNewForm(false);
    setViews((v) => ({ ...v, [form.id]: "form" }));
    openTable(form.id);
  }

  const formChanged = (f: FormInfo) => setForms((prev) => prev.map((x) => (x.id === f.id ? f : x)));

  async function renameForm(f: FormInfo) {
    const name = prompt("Form name", f.name);
    if (!name || name === f.name) return;
    try {
      const { form } = await api<{ form: FormInfo }>(`/api/forms/${f.id}`, { method: "PATCH", body: { name } });
      formChanged(form);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function deleteForm(f: FormInfo) {
    const online = f.online?.published ? " Its online form stops taking responses." : "";
    if (!confirm(`Delete the form "${f.name}"? The records it shows stay.${online}`)) return;
    try {
      await api(`/api/forms/${f.id}`, { method: "DELETE" });
      closeTab(f.id);
      setForms((prev) => prev.filter((x) => x.id !== f.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function createReport(input: { name: string; source: ReportSource }) {
    const { report } = await api<{ report: ReportInfo }>(`/api/databases/${database.id}/reports`, { body: input });
    setReports((prev) => [...prev, report]);
    setNewReport(false);
    setViews((v) => ({ ...v, [report.id]: "report" }));
    openTable(report.id);
  }

  const reportChanged = (r: ReportInfo) => setReports((prev) => prev.map((x) => (x.id === r.id ? r : x)));

  async function renameReport(r: ReportInfo) {
    const name = prompt("Report name", r.name);
    if (!name || name === r.name) return;
    try {
      const { report } = await api<{ report: ReportInfo }>(`/api/reports/${r.id}`, { method: "PATCH", body: { name } });
      reportChanged(report);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function deleteReport(r: ReportInfo) {
    if (!confirm(`Delete the report "${r.name}"? The records it shows stay.`)) return;
    try {
      await api(`/api/reports/${r.id}`, { method: "DELETE" });
      closeTab(r.id);
      setReports((prev) => prev.filter((x) => x.id !== r.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function renameDatabase() {
    const name = prompt("Database name", database.name);
    if (!name || name === database.name) return;
    try {
      const { database: d } = await api<{ database: DatabaseInfo }>(`/api/databases/${database.id}`, { method: "PATCH", body: { name } });
      setDatabase(d);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const activeTable = tables.find((t) => t.id === active);
  const showRel = active === REL;
  const view = (active && views[active]) || "datasheet";
  const activeQuery = queries.find((q) => q.id === active);
  const activeForm = forms.find((f) => f.id === active);
  const activeReport = reports.find((r) => r.id === active);
  const shown = tables.filter((t) => t.name.toLowerCase().includes(filterText.toLowerCase()));
  const shownQueries = queries.filter((q) => q.name.toLowerCase().includes(filterText.toLowerCase()));
  const shownForms = forms.filter((f) => f.name.toLowerCase().includes(filterText.toLowerCase()));
  const shownReports = reports.filter((r) => r.name.toLowerCase().includes(filterText.toLowerCase()));

  return (
    <div className="workspace">
      <aside className="nav">
        <div className="nav-head">
          <a href="/" className="back" aria-label="All databases">
            ←
          </a>
          <button className="db-name" onClick={canEdit ? renameDatabase : undefined} title={canEdit ? "Rename database" : database.name}>
            {database.name}
          </button>
          <button className="share-btn" onClick={() => setSharing(true)} title="Share this database">
            Share
          </button>
        </div>
        <input className="search" type="search" placeholder="Search objects" value={filterText} onChange={(e) => setFilterText(e.target.value)} />
        <h4>Tables</h4>
        <ul>
          {shown.map((t) => (
            <li key={t.id} className={t.id === active ? "on" : ""}>
              <button className="obj" onClick={() => openTable(t.id)} onDoubleClick={() => openTable(t.id)}>
                <span className="icon">▦</span> {t.name}
              </button>
              {canEdit && (
                <span className="obj-actions">
                  <button aria-label={`Rename ${t.name}`} title="Rename" onClick={() => renameTable(t)}>
                    ✎
                  </button>
                  <button aria-label={`Delete ${t.name}`} title="Delete" onClick={() => deleteTable(t)}>
                    🗑
                  </button>
                </span>
              )}
            </li>
          ))}
          {tables.length === 0 && <li className="muted">No tables yet.</li>}
        </ul>
        <h4>Queries</h4>
        <ul>
          {shownQueries.map((q) => (
            <li key={q.id} className={q.id === active ? "on" : ""}>
              <button className="obj" onClick={() => openTable(q.id)}>
                <span className="icon">⌕</span> {q.name}
              </button>
              {canEdit && (
                <span className="obj-actions">
                  <button aria-label={`Rename ${q.name}`} title="Rename" onClick={() => renameQuery(q)}>
                    ✎
                  </button>
                  <button aria-label={`Delete ${q.name}`} title="Delete" onClick={() => deleteQuery(q)}>
                    🗑
                  </button>
                </span>
              )}
            </li>
          ))}
          {queries.length === 0 && <li className="muted">No queries yet.</li>}
        </ul>
        <h4>Forms</h4>
        <ul>
          {shownForms.map((f) => (
            <li key={f.id} className={f.id === active ? "on" : ""}>
              <button className="obj" onClick={() => openTable(f.id)}>
                <span className="icon">▤</span> {f.name}
                {f.online?.published && <span className="online-dot" title="Online form taking responses" />}
              </button>
              {canEdit && (
                <span className="obj-actions">
                  <button aria-label={`Rename ${f.name}`} title="Rename" onClick={() => renameForm(f)}>
                    ✎
                  </button>
                  <button aria-label={`Delete ${f.name}`} title="Delete" onClick={() => deleteForm(f)}>
                    🗑
                  </button>
                </span>
              )}
            </li>
          ))}
          {forms.length === 0 && <li className="muted">No forms yet.</li>}
        </ul>
        <h4>Reports</h4>
        <ul>
          {shownReports.map((r) => (
            <li key={r.id} className={r.id === active ? "on" : ""}>
              <button className="obj" onClick={() => openTable(r.id)}>
                <span className="icon">▥</span> {r.name}
              </button>
              {canEdit && (
                <span className="obj-actions">
                  <button aria-label={`Rename ${r.name}`} title="Rename" onClick={() => renameReport(r)}>
                    ✎
                  </button>
                  <button aria-label={`Delete ${r.name}`} title="Delete" onClick={() => deleteReport(r)}>
                    🗑
                  </button>
                </span>
              )}
            </li>
          ))}
          {reports.length === 0 && <li className="muted">No reports yet.</li>}
        </ul>
        <h4>Tools</h4>
        <ul>
          <li className={showRel ? "on" : ""}>
            <button className="obj" onClick={() => openTable(REL)}>
              <span className="icon">⇄</span> Relationships
            </button>
          </li>
        </ul>
        {canEdit && (
          <div className="nav-actions">
            <button className="primary" onClick={newTable}>
              New table
            </button>
            <button onClick={newQuery}>New query</button>
            <button onClick={() => setNewForm(true)} disabled={tables.length === 0} title={tables.length ? undefined : "Make a table first"}>
              New form
            </button>
            <button onClick={() => setNewReport(true)} disabled={tables.length === 0} title={tables.length ? undefined : "Make a table first"}>
              New report
            </button>
            <button onClick={() => fileRef.current?.click()}>Import CSV</button>
            <button onClick={() => accessRef.current?.click()}>Import Access</button>
            <input
              ref={accessRef}
              type="file"
              accept=".accdb,.mdb"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void importAccess(f);
              }}
            />
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.tsv,text/csv"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void importCsv(f);
              }}
            />
          </div>
        )}
        {busy && <p className="muted small">{busy}</p>}
        {!canEdit && <p className="muted small">You can view this database but not change it.</p>}
      </aside>

      <main className="objects">
        {error && (
          <div className="error-bar" role="alert">
            {error} <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        {notice && (
          <div className="notice-bar" role="status">
            <div>
              <strong>{notice.title}</strong>
              {notice.notes.length > 0 && (
                <ul>
                  {notice.notes.map((n, i) => (
                    <li key={i}>{n}.</li>
                  ))}
                </ul>
              )}
            </div>
            <button onClick={() => setNotice(null)}>Dismiss</button>
          </div>
        )}
        <div className="tabs" role="tablist">
          {open.map((id) => {
            const t = id === REL ? { name: "Relationships" } : tables.find((x) => x.id === id) ?? queries.find((x) => x.id === id) ?? forms.find((x) => x.id === id) ?? reports.find((x) => x.id === id);
            if (!t) return null;
            // A form is often named after its table, so the tab shows which kind of object it is.
            const icon = id === REL ? "⇄" : tables.some((x) => x.id === id) ? "▦" : queries.some((x) => x.id === id) ? "⌕" : forms.some((x) => x.id === id) ? "▤" : "▥";
            return (
              <div key={id} className={`tab ${id === active ? "on" : ""}`} role="tab" aria-selected={id === active}>
                <button onClick={() => setActive(id)}>
                  <span className="tab-icon">{icon}</span> {t.name}
                </button>
                <button aria-label={`Close ${t.name}`} onClick={() => closeTab(id)}>
                  ✕
                </button>
              </div>
            );
          })}
          {activeQuery && (
            <div className="view-switch">
              {(["datasheet", "design", "sql"] as const).map((m) => (
                <button key={m} className={view === m ? "on" : ""} onClick={() => setViews((v) => ({ ...v, [activeQuery.id]: m }))}>
                  {m === "sql" ? "SQL" : m === "design" ? "Design" : "Datasheet"}
                </button>
              ))}
            </div>
          )}
          {activeForm && (
            <div className="view-switch">
              {(["form", "design"] as const).map((m) => (
                <button key={m} className={(views[activeForm.id] ?? "form") === m ? "on" : ""} onClick={() => setViews((v) => ({ ...v, [activeForm.id]: m }))}>
                  {m === "form" ? "Form" : "Design"}
                </button>
              ))}
            </div>
          )}
          {activeReport && (
            <div className="view-switch">
              {(["report", "design"] as const).map((m) => (
                <button key={m} className={(views[activeReport.id] ?? "report") === m ? "on" : ""} onClick={() => setViews((v) => ({ ...v, [activeReport.id]: m }))}>
                  {m === "report" ? "Report" : "Design"}
                </button>
              ))}
            </div>
          )}
          {activeTable && (
            <div className="view-switch">
              {(["datasheet", "gallery", "board", "calendar", "design"] as const).map((m) => (
                <button key={m} className={view === m ? "on" : ""} onClick={() => setViews((v) => ({ ...v, [activeTable.id]: m }))}>
                  {m[0].toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          )}
        </div>
        {showRel ? (
          <Relationships tables={tables} onOpen={openTable} />
        ) : activeQuery || activeForm || activeReport ? null : activeTable ? (
          view === "design" ? (
            <Design key={activeTable.id} table={activeTable} tables={tables} canEdit={canEdit} onTableChanged={refresh} />
          ) : view === "gallery" || view === "board" || view === "calendar" ? (
            <ListViews key={activeTable.id} table={activeTable} tables={tables} mode={view} canEdit={canEdit} onTableChanged={refresh} />
          ) : (
            <Datasheet key={activeTable.id} table={activeTable} tables={tables} canEdit={canEdit} onTableChanged={refresh} />
          )
        ) : (
          <div className="start">
            <h2>{tables.length ? "Open a table from the list" : "Start with a table"}</h2>
            {canEdit && tables.length === 0 && (
              <p>
                <button className="primary" onClick={newTable}>
                  New table
                </button>{" "}
                or <button onClick={() => fileRef.current?.click()}>import a CSV file</button>
              </p>
            )}
          </div>
        )}
        {/* Open queries stay mounted while other tabs are shown, so unsaved design work isn't lost. */}
        {queries
          .filter((q) => open.includes(q.id))
          .map((q) => (
            <div key={q.id} className="query-tab" hidden={q.id !== active}>
              <QueryView
                databaseId={database.id}
                query={q}
                tables={tables}
                canEdit={canEdit}
                aiEnabled={aiEnabled}
                mode={(views[q.id] as QueryMode | undefined) ?? "datasheet"}
                onMode={(m) => setViews((v) => ({ ...v, [q.id]: m }))}
                onSaved={(saved) => setQueries((prev) => prev.map((x) => (x.id === saved.id ? saved : x)))}
              />
            </div>
          ))}
        {/* Open forms stay mounted too, keeping the record shown and unsaved design changes. */}
        {forms
          .filter((f) => open.includes(f.id))
          .map((f) => {
            const table = tables.find((t) => t.id === f.tableId);
            if (!table) return null;
            return (
              <div key={f.id} className="query-tab" hidden={f.id !== active}>
                {(views[f.id] ?? "form") === "design" ? (
                  <FormDesign form={f} table={table} canEdit={canEdit} onFormChanged={formChanged} />
                ) : (
                  <FormView form={f} table={table} tables={tables} canEdit={canEdit} onFormChanged={formChanged} onTableChanged={refresh} />
                )}
              </div>
            );
          })}
        {/* Open reports stay mounted too, keeping unsaved design changes. */}
        {reports
          .filter((r) => open.includes(r.id))
          .map((r) => (
            <div key={r.id} className="query-tab" hidden={r.id !== active}>
              {(views[r.id] ?? "report") === "design" ? (
                <ReportDesign report={r} tables={tables} queries={queries} canEdit={canEdit} onSaved={reportChanged} />
              ) : (
                <ReportView report={r} />
              )}
            </div>
          ))}
        {newReport && <NewReportDialog tables={tables} queries={queries} onCancel={() => setNewReport(false)} onCreate={createReport} />}
        {sharing && <ShareDialog database={database} me={me} onClose={() => setSharing(false)} />}
        {newForm && <NewFormDialog tables={tables} onCancel={() => setNewForm(false)} onCreate={createForm} />}
      </main>
    </div>
  );
}
