"use client";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { type Ctx, type Task, api, formData } from "./client";
import { Modal } from "./Modal";
import { TaskList } from "./Home";

type TemplateTask = { title: string; owner: "employee" | "manager" | "hr"; dueDays: number };
type Template = { id: string; kind: "onboarding" | "offboarding"; name: string; tasks: TemplateTask[] };
type Checklist = { id: string; employee_id: string; employee_name: string; kind: string; title: string; created_at: string; tasks: Task[] };

const OWNER_LABELS = { employee: "The person", manager: "Their manager", hr: "HR" };

export function Onboarding({ ctx }: { ctx: Ctx }) {
  const admin = ctx.me.roles.hrAdmin;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [lists, setLists] = useState<Checklist[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [starting, setStarting] = useState(false);
  const [editing, setEditing] = useState<Template | "new" | null>(null);

  const load = async () => {
    const [t, l, tp] = await Promise.all([
      api<Task[]>("/api/tasks"),
      api<Checklist[]>("/api/checklists"),
      admin ? api<Template[]>("/api/templates") : Promise.resolve([]),
    ]);
    setTasks(t);
    setLists(l);
    setTemplates(tp);
  };
  useEffect(() => {
    load().catch((e) => ctx.toast((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = async (t: Task) => {
    try {
      await api(`/api/tasks/${t.id}`, { method: "POST", json: { done: !t.done_at } });
    } catch (e) {
      ctx.toast((e as Error).message);
    }
    await Promise.all([load(), ctx.reloadMe()]);
  };

  const open = lists.filter((l) => l.tasks.some((t) => !t.done_at));
  const finished = lists.filter((l) => l.tasks.length && l.tasks.every((t) => t.done_at));

  return (
    <main className="view">
      <div className="viewhead">
        <h1>Onboarding</h1>
        {admin && <button className="btn primary right" onClick={() => setStarting(true)}><Plus size={16} /> Start a checklist</button>}
      </div>
      <div className="viewbody">
        <section className="section">
          <h3>Your tasks</h3>
          <TaskList tasks={tasks} onToggle={toggle} />
        </section>

        {[["In progress", open], ["Finished", finished]].map(([label, group]) => (group as Checklist[]).length > 0 && (
          <section className="section" key={label as string}>
            <h3>{label as string}</h3>
            {(group as Checklist[]).map((c) => {
              const done = c.tasks.filter((t) => t.done_at).length;
              return (
                <details key={c.id} className="card">
                  <summary className="row" style={{ cursor: "pointer" }}>
                    <b>{c.title}</b>
                    <span className="muted small">{done} of {c.tasks.length} done</span>
                    <div className="progress grow" style={{ maxWidth: 160 }}><div style={{ width: `${(100 * done) / Math.max(1, c.tasks.length)}%` }} /></div>
                    {admin && (
                      <button className="iconbtn right" aria-label="Remove checklist" onClick={async (e) => {
                        e.preventDefault();
                        if (!window.confirm(`Remove "${c.title}"?`)) return;
                        await api(`/api/checklists/${c.id}`, { method: "DELETE" });
                        await Promise.all([load(), ctx.reloadMe()]);
                      }}><Trash2 size={15} /></button>
                    )}
                  </summary>
                  <div style={{ marginTop: 10 }}>
                    <TaskList tasks={c.tasks} onToggle={toggle} />
                  </div>
                </details>
              );
            })}
          </section>
        ))}

        {admin && (
          <section className="section">
            <div className="row"><h3 style={{ margin: 0 }}>Checklist templates</h3><button className="btn small right" onClick={() => setEditing("new")}><Plus size={14} /> New template</button></div>
            <table className="list"><tbody>
              {templates.map((t) => (
                <tr key={t.id} className="click" onClick={() => setEditing(t)}>
                  <td><b>{t.name}</b></td><td>{t.kind === "onboarding" ? "Joining" : "Leaving"}</td><td className="num">{t.tasks.length} tasks</td>
                </tr>
              ))}
            </tbody></table>
          </section>
        )}
      </div>
      {starting && (
        <StartDialog ctx={ctx} templates={templates} onClose={() => setStarting(false)} onDone={async () => { setStarting(false); ctx.toast("Checklist started"); await Promise.all([load(), ctx.reloadMe()]); }} />
      )}
      {editing && <TemplateDialog t={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={async () => { setEditing(null); await load(); }} />}
    </main>
  );
}

function StartDialog({ ctx, templates, onClose, onDone }: { ctx: Ctx; templates: Template[]; onClose: () => void; onDone: () => void }) {
  const [err, setErr] = useState("");
  return (
    <Modal title="Start a checklist" onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api("/api/checklists", { method: "POST", json: formData(e.currentTarget) });
          onDone();
        } catch (x) {
          setErr((x as Error).message);
        }
      }}>
        <label><span>Person</span>
          <select name="employeeId" required>{ctx.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </label>
        <label><span>Checklist</span>
          <select name="templateId" required>{templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.kind === "onboarding" ? "joining" : "leaving"})</option>)}</select>
        </label>
        <p className="small muted">Due dates count from their start date for joining, or their last day for leaving. Tasks go to the person, their manager or HR.</p>
        <p className="error" role="alert">{err}</p>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Start</button></div>
      </form>
    </Modal>
  );
}

function TemplateDialog({ t, onClose, onDone }: { t: Template | null; onClose: () => void; onDone: () => void }) {
  const [tasks, setTasks] = useState<TemplateTask[]>(t?.tasks ?? [{ title: "", owner: "hr", dueDays: 0 }]);
  const [err, setErr] = useState("");
  const set = (i: number, patch: Partial<TemplateTask>) => setTasks(tasks.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Modal title={t ? t.name : "New checklist template"} onClose={onClose} wide>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const b = formData(e.currentTarget);
        try {
          await api(t ? `/api/templates/${t.id}` : "/api/templates", { method: t ? "PUT" : "POST", json: { name: b.name, kind: b.kind, tasks } });
          onDone();
        } catch (x) {
          setErr((x as Error).message);
        }
      }}>
        <div className="grid2">
          <label><span>Name</span><input name="name" defaultValue={t?.name} required /></label>
          <label><span>For people</span><select name="kind" defaultValue={t?.kind ?? "onboarding"}><option value="onboarding">Joining</option><option value="offboarding">Leaving</option></select></label>
        </div>
        <table className="list">
          <thead><tr><th>Task</th><th>Who</th><th>Due (days from start or last day)</th><th /></tr></thead>
          <tbody>
            {tasks.map((x, i) => (
              <tr key={i}>
                <td><input value={x.title} onChange={(e) => set(i, { title: e.target.value })} aria-label="Task" /></td>
                <td><select value={x.owner} onChange={(e) => set(i, { owner: e.target.value as TemplateTask["owner"] })} aria-label="Who">
                  {Object.entries(OWNER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></td>
                <td><input type="number" value={x.dueDays} onChange={(e) => set(i, { dueDays: Number(e.target.value) })} aria-label="Due" style={{ width: 90 }} /></td>
                <td><button type="button" className="iconbtn" aria-label="Remove task" onClick={() => setTasks(tasks.filter((_, j) => j !== i))}><Trash2 size={15} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} onClick={() => setTasks([...tasks, { title: "", owner: "hr", dueDays: 0 }])}><Plus size={14} /> Add task</button>
        <p className="error" role="alert">{err}</p>
        <div className="actions">
          {t && <button type="button" className="btn ghost" style={{ marginRight: "auto", color: "var(--danger)" }} onClick={async () => { await api(`/api/templates/${t.id}`, { method: "DELETE" }); onDone(); }}>Delete template</button>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}
