"use client";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "./client";
import type { AppInfo } from "./ContractsApp";
import { Confirm, Modal } from "./Modal";

type Template = { id: string; name: string; type: string; description: string; body: string; archived: boolean; fields: string[]; clauses: string[] };
type Clause = { id: string; title: string; category: string; body: string; guidance: string; fallback: string; required: boolean; archived: boolean };

export function LibraryView({ tab, focus, info }: { tab: "templates" | "clauses"; focus?: string; info: AppInfo }) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [clauses, setClauses] = useState<Clause[] | null>(null);
  const [editing, setEditing] = useState<Template | Clause | "new" | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      if (tab === "templates") setTemplates(await api<Template[]>(`/api/templates?all=1`));
      else setClauses(await api<Clause[]>(`/api/clauses?all=1`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [tab]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!focus) return;
    const hit = (tab === "templates" ? templates : clauses)?.find((x) => x.id === focus);
    if (hit) setEditing(hit);
  }, [focus, tab, templates, clauses]);

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>{tab === "templates" ? "Templates" : "Clause library"}</h1>
          <p className="sub muted">
            {tab === "templates"
              ? "Standard contracts to start from. Write fields as {{Field name}} and pull in a clause with {{clause: Title}}."
              : "Approved wording. Required clauses are checked by the AI review, and the guidance tells it your position."}
            {!info.library && " The legal team keeps the library."}
          </p>
        </div>
        {info.library && <button className="btn primary" onClick={() => setEditing("new")}><Plus size={16} /> New {tab === "templates" ? "template" : "clause"}</button>}
      </div>
      <div className="body">
        {error && <p className="error">{error}</p>}
        {tab === "templates" && templates && (
          !templates.length ? <div className="empty">No templates yet.</div> : (
            <div className="tablewrap">
              <table className="grid">
                <thead><tr><th>Template</th><th>Type</th><th>Fields</th><th>Clauses</th></tr></thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={t.id} className={`click${t.archived ? " done" : ""}`} onClick={() => setEditing(t)}>
                      <td>{t.name}{t.archived && <span className="pill">archived</span>}<div className="muted small">{t.description}</div></td>
                      <td>{t.type}</td>
                      <td className="muted small">{t.fields.join(", ")}</td>
                      <td className="muted small">{t.clauses.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
        {tab === "clauses" && clauses && (
          !clauses.length ? <div className="empty">No clauses yet.</div> : (
            <div className="tablewrap">
              <table className="grid">
                <thead><tr><th>Clause</th><th>Category</th><th>Standard text</th></tr></thead>
                <tbody>
                  {clauses.map((c) => (
                    <tr key={c.id} className={`click${c.archived ? " done" : ""}`} onClick={() => setEditing(c)}>
                      <td>{c.title} {c.required && <span className="pill submitted">required</span>}{c.archived && <span className="pill">archived</span>}</td>
                      <td>{c.category}</td>
                      <td className="muted small clip">{c.body}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
      {editing && tab === "templates" && (
        <TemplateDialog t={editing === "new" ? null : (editing as Template)} info={info} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />
      )}
      {editing && tab === "clauses" && (
        <ClauseDialog c={editing === "new" ? null : (editing as Clause)} info={info} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />
      )}
    </>
  );
}

function TemplateDialog({ t, info, onClose, onSaved }: { t: Template | null; info: AppInfo; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ name: t?.name ?? "", type: t?.type ?? "Other", description: t?.description ?? "", body: t?.body ?? "", archived: t?.archived ?? false });
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const ro = !info.library;
  return (
    <Modal title={t ? t.name : "New template"} onClose={onClose} wide>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api(t ? `/api/templates/${t.id}` : "/api/templates", { method: t ? "PUT" : "POST", json: v });
            onSaved();
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="row2">
            <label><span>Name</span><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required /></label>
            <label><span>Type</span><select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>{info.types.map((x) => <option key={x}>{x}</option>)}</select></label>
          </div>
          <label><span>When to use it</span><input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></label>
          <label><span>Text</span><textarea className="bodyedit" rows={18} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} /></label>
          <p className="muted small">Built-in fields: Counterparty, Counterparty email, Title, Start date, End date, Value, Currency, Owner, Today.</p>
          {t && <label className="check"><input type="checkbox" checked={v.archived} onChange={(e) => setV({ ...v, archived: e.target.checked })} /> Archived (hidden when starting a contract)</label>}
        </fieldset>
        <p className="error">{error}</p>
        {!ro && (
          <div className="actions">
            {t && <button type="button" className="btn" onClick={() => setConfirm(true)}>Delete</button>}
            <span className="grow" />
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary">Save</button>
          </div>
        )}
      </form>
      {confirm && t && (
        <Confirm title="Delete template" message={`Delete ${t.name}? Contracts made from it keep their text.`} action="Delete" danger onClose={() => setConfirm(false)}
          onConfirm={async () => { await api(`/api/templates/${t.id}`, { method: "DELETE" }); onSaved(); }} />
      )}
    </Modal>
  );
}

function ClauseDialog({ c, info, onClose, onSaved }: { c: Clause | null; info: AppInfo; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({
    title: c?.title ?? "", category: c?.category ?? "General", body: c?.body ?? "", guidance: c?.guidance ?? "", fallback: c?.fallback ?? "",
    required: c?.required ?? false, archived: c?.archived ?? false,
  });
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const ro = !info.library;
  return (
    <Modal title={c ? c.title : "New clause"} onClose={onClose} wide>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api(c ? `/api/clauses/${c.id}` : "/api/clauses", { method: c ? "PUT" : "POST", json: v });
            onSaved();
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="row2">
            <label><span>Title</span><input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} required /></label>
            <label><span>Category</span><input value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} /></label>
          </div>
          <label><span>Standard text</span><textarea rows={8} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} /></label>
          <label><span>Our position (guidance for reviewers and the AI review)</span><textarea rows={3} value={v.guidance} onChange={(e) => setV({ ...v, guidance: e.target.value })} /></label>
          <label><span>Fallback wording we can accept</span><textarea rows={4} value={v.fallback} onChange={(e) => setV({ ...v, fallback: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={v.required} onChange={(e) => setV({ ...v, required: e.target.checked })} /> Every contract must cover this</label>
          {c && <label className="check"><input type="checkbox" checked={v.archived} onChange={(e) => setV({ ...v, archived: e.target.checked })} /> Archived</label>}
        </fieldset>
        <p className="error">{error}</p>
        {!ro && (
          <div className="actions">
            {c && <button type="button" className="btn" onClick={() => setConfirm(true)}>Delete</button>}
            <span className="grow" />
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary">Save</button>
          </div>
        )}
      </form>
      {confirm && c && (
        <Confirm title="Delete clause" message={`Delete ${c.title}? Templates that use it will show a gap where it was.`} action="Delete" danger onClose={() => setConfirm(false)}
          onConfirm={async () => { await api(`/api/clauses/${c.id}`, { method: "DELETE" }); onSaved(); }} />
      )}
    </Modal>
  );
}
