"use client";
import { ArrowDown, ArrowUp, Diamond, ExternalLink, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DraftPlan } from "@/lib/plan-ai";
import type { Project, Task } from "@/lib/types";
import { addDaysStr, api, daysApart, hrs, hrsLabel, person, shortDate, todayStr } from "./client";
import { Modal } from "./Modal";
import type { AppStatus } from "./ProjectsApp";

/** Workdays from start to finish, both counted, as the server counts them. */
function workdays(start: string, finish: string): number {
  let n = 0;
  for (let d = start; d <= finish; d = addDaysStr(d, 1)) {
    const [y, m, dd] = d.split("-").map(Number);
    const w = new Date(y, m - 1, dd).getDay();
    if (w !== 0 && w !== 6) n++;
    if (n > 3000) break;
  }
  return Math.max(1, n);
}

export function PlanTab({ project, status, cardLinks, focusTask, onPlannerSync }: {
  project: Project; status: AppStatus; cardLinks: Record<string, string>; focusTask?: string; onPlannerSync: () => void;
}) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [open, setOpen] = useState<string | null>(focusTask ?? null);
  const [error, setError] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState("");
  const manager = project.myRole === "manager";
  const today = todayStr();

  const load = useCallback(async () => {
    try {
      setTasks(await api<Task[]>(`/api/projects/${project.id}/tasks`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [project.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const range = useMemo(() => {
    const days = (tasks ?? []).flatMap((t) => [t.start, t.finish]).filter((d): d is string => !!d);
    if (project.start) days.push(project.start);
    if (project.finish) days.push(project.finish);
    if (!days.length) return null;
    days.sort();
    const from = addDaysStr(days[0], -1);
    const to = addDaysStr(days[days.length - 1], 2);
    return { from, span: Math.max(7, daysApart(from, to)) };
  }, [tasks, project.start, project.finish]);

  const add = async (title: string) => {
    setError("");
    try {
      const start = project.start && project.start > today ? project.start : today;
      await api(`/api/projects/${project.id}/tasks`, { method: "POST", json: { title, start, durationDays: 1 } });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const sync = async () => {
    setSyncing(true);
    setError("");
    try {
      const r = await api<{ added: number; updated: number; tasks: Task[] }>(`/api/projects/${project.id}/planner`, { method: "POST" });
      setTasks(r.tasks);
      setNote(`From Planner: ${r.added} new, ${r.updated} updated.`);
      onPlannerSync();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  if (!tasks) return <p className="pad muted">{error || "Loading…"}</p>;
  const current = tasks.find((t) => t.id === open) ?? null;
  const pct = (day: string) => (range ? (daysApart(range.from, day) / range.span) * 100 : 0);
  const scale: string[] = [];
  if (range) for (let d = range.from, i = 0; i <= range.span; i += 7, d = addDaysStr(d, 7)) scale.push(d);

  return (
    <div className="body">
      <div className="toolbar">
        <form
          className="addrow grow"
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem("title") as HTMLInputElement;
            if (input.value.trim()) void add(input.value.trim());
            input.value = "";
          }}
        >
          <input className="cellin" name="title" placeholder="Add a task" aria-label="New task title" />
          <button className="btn">Add</button>
        </form>
        {manager && status.ai && <button className="btn" onClick={() => setDrafting(true)}><Sparkles size={15} /> Draft a plan</button>}
        {manager && project.plannerBoardId && (
          <button className="btn" onClick={() => void sync()} disabled={syncing}><RefreshCw size={15} /> {syncing ? "Syncing…" : "Sync from Planner"}</button>
        )}
      </div>
      {note && <p className="ok small" style={{ margin: 0 }}>{note}</p>}
      <p className="error" role="alert">{error}</p>
      {!tasks.length ? (
        <div className="empty">
          <p>No tasks yet. Add one above{manager && status.ai ? ", or draft a plan from the project's description" : ""}{manager && project.plannerBoardId ? ", or bring in the Planner board's cards" : ""}.</p>
        </div>
      ) : (
        <div className="tablewrap plan">
          <table className="grid">
            <thead>
              <tr>
                <th>Task</th><th>Assigned</th><th>Start</th><th>Finish</th><th className="num">Days</th><th className="num">Estimate</th>
                <th className="num">Logged</th><th className="num">Done</th>
                <th style={{ minWidth: 320 }}>
                  <div className="ganttscale">
                    {scale.map((d) => <span key={d} style={{ left: `${pct(d)}%` }}>{shortDate(d)}</span>)}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => {
                const late = !t.summary && t.percentDone < 100 && !!t.finish && t.finish < today;
                return (
                  <tr key={t.id} className={`click${t.summary ? " summary" : ""}${open === t.id ? " sel" : ""}`} onClick={() => setOpen(t.id)}>
                    <td className="title">
                      <span className="ind" style={{ width: t.depth * 18 }} />
                      <span className="wbs">{t.wbs}</span>
                      {t.milestone && <Diamond size={12} style={{ marginRight: 4 }} />}
                      {t.title}
                    </td>
                    <td>{t.assignedTo ? person(t.assignedTo) : ""}</td>
                    <td className={late ? "error" : ""}>{shortDate(t.start)}</td>
                    <td className={late ? "error" : ""}>{shortDate(t.finish)}</td>
                    <td className="num">{t.start && t.finish && !t.milestone ? workdays(t.start, t.finish) : ""}</td>
                    <td className="num">{t.estimateMinutes ? hrsLabel(t.estimateMinutes) : ""}</td>
                    <td className={`num${t.estimateMinutes && t.loggedMinutes > t.estimateMinutes ? " error" : ""}`}>{t.loggedMinutes ? hrsLabel(t.loggedMinutes) : ""}</td>
                    <td className="num">{t.percentDone}%</td>
                    <td>
                      {range && t.start && t.finish && (
                        <div className="gantt">
                          {today >= range.from && <span className="today" style={{ left: `${pct(today)}%` }} />}
                          {t.milestone ? (
                            <span className="ms" style={{ left: `${pct(t.start) + 50 / range.span}%` }} title={`${t.title}: ${shortDate(t.start)}`} />
                          ) : (
                            <span
                              className={`bar${t.summary ? " summary" : ""}${late ? " late" : ""}`}
                              style={{ left: `${pct(t.start)}%`, width: `${Math.max(0.6, ((daysApart(t.start, t.finish) + 1) / range.span) * 100)}%` }}
                              title={`${t.title}: ${shortDate(t.start)} to ${shortDate(t.finish)}, ${t.percentDone}% done`}
                            >
                              {!t.summary && <i style={{ width: `${t.percentDone}%` }} />}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small" style={{ margin: 0 }}>
        Dates are workdays, Monday to Friday. A task with predecessors starts the workday after they finish, and moves later when they do.
      </p>
      {current && (
        <TaskPanel
          // Remount when the server moves dates (successors, rollups) so the fields show them.
          key={`${current.id}/${current.start}/${current.finish}/${current.parentId}/${current.summary}`}
          task={current}
          tasks={tasks}
          project={project}
          cardLink={cardLinks[current.id]}
          onClose={() => setOpen(null)}
          onSaved={setTasks}
          onDeleted={async () => {
            setOpen(null);
            await load();
          }}
        />
      )}
      {drafting && <DraftDialog project={project} onClose={() => setDrafting(false)} onAdded={(t) => { setTasks(t); setDrafting(false); }} />}
    </div>
  );
}

function TaskPanel({ task, tasks, project, cardLink, onClose, onSaved, onDeleted }: {
  task: Task; tasks: Task[]; project: Project; cardLink?: string; onClose: () => void; onSaved: (t: Task[]) => void; onDeleted: () => void;
}) {
  const [error, setError] = useState("");
  const patch = async (body: Record<string, unknown>) => {
    setError("");
    try {
      onSaved(await api<Task[]>(`/api/projects/${project.id}/tasks/${task.id}`, { method: "PATCH", json: body }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  // A task can't go under itself or its own subtasks.
  const below = new Set<string>([task.id]);
  for (const t of tasks) if (t.parentId && below.has(t.parentId)) below.add(t.id);
  const parents = tasks.filter((t) => !below.has(t.id));
  const preds = tasks.filter((t) => t.id !== task.id);
  const index = tasks.findIndex((t) => t.id === task.id);
  const disabledDates = task.summary;

  return (
    <aside className="panel" aria-label="Task details">
      <div className="modalhead">
        <h2>{task.wbs} {task.summary ? "Summary task" : task.milestone ? "Milestone" : "Task"}</h2>
        <button className="iconbtn" aria-label="Close" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="form" onClick={(e) => e.stopPropagation()}>
        <label><span>Title</span>
          <input defaultValue={task.title} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== task.title) void patch({ title: e.target.value }); }} />
        </label>
        <div className="row2">
          <label><span>Start</span>
            <input type="date" defaultValue={task.start ?? ""} disabled={disabledDates} onChange={(e) => void patch({ start: e.target.value })} />
          </label>
          <label><span>{task.milestone ? "Date" : "Finish"}</span>
            <input type="date" defaultValue={task.finish ?? ""} disabled={disabledDates || task.milestone} onChange={(e) => void patch({ finish: e.target.value })} />
          </label>
        </div>
        {disabledDates && <p className="muted small">Dates, estimate and progress come from the subtasks.</p>}
        {!task.summary && (
          <div className="row2">
            <label><span>Estimate (hours)</span>
              <input inputMode="decimal" defaultValue={hrs(task.estimateMinutes)} onBlur={(e) => e.target.value !== hrs(task.estimateMinutes) && void patch({ estimateHours: e.target.value })} />
            </label>
            <label><span>Done (%)</span>
              <input type="number" min={0} max={100} step={5} defaultValue={task.percentDone} onBlur={(e) => Number(e.target.value) !== task.percentDone && void patch({ percentDone: Number(e.target.value) })} />
            </label>
          </div>
        )}
        <label><span>Assigned to</span>
          <select defaultValue={task.assignedTo ?? ""} onChange={(e) => void patch({ assignedTo: e.target.value })}>
            <option value="">Nobody</option>
            {project.members.map((m) => <option key={m.email} value={m.email}>{person(m.email)}</option>)}
          </select>
        </label>
        <label><span>Under</span>
          <select defaultValue={task.parentId ?? ""} onChange={(e) => void patch({ parentId: e.target.value })}>
            <option value="">Top level</option>
            {parents.map((t) => <option key={t.id} value={t.id}>{t.wbs} {t.title}</option>)}
          </select>
        </label>
        <label><span>Starts after</span>
          <select
            multiple
            size={Math.min(6, Math.max(3, preds.length))}
            defaultValue={task.dependsOn}
            onChange={(e) => void patch({ dependsOn: [...e.target.selectedOptions].map((o) => o.value) })}
          >
            {preds.map((t) => <option key={t.id} value={t.id}>{t.wbs} {t.title}</option>)}
          </select>
        </label>
        {!task.summary && (
          <>
            <label className="check"><input type="checkbox" defaultChecked={task.milestone} onChange={(e) => void patch({ milestone: e.target.checked })} /> Milestone</label>
            {project.billing === "time" && (
              <label className="check"><input type="checkbox" defaultChecked={task.billable} onChange={(e) => void patch({ billable: e.target.checked })} /> Time on it is billable by default</label>
            )}
          </>
        )}
        <label><span>Notes</span>
          <textarea defaultValue={task.notes} rows={4} onBlur={(e) => e.target.value !== task.notes && void patch({ notes: e.target.value })} />
        </label>
        <p className="muted small">{hrsLabel(task.loggedMinutes)} logged{task.estimateMinutes ? ` of ${hrsLabel(task.estimateMinutes)} estimated` : ""}.</p>
        {cardLink && <a className="btn" href={cardLink} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open the Planner card</a>}
        <p className="error" role="alert">{error}</p>
        <div className="actions" style={{ justifyContent: "space-between" }}>
          <span>
            <button className="iconbtn" aria-label="Move up" title="Move up" disabled={index <= 0} onClick={() => void patch({ position: index - 1 })}><ArrowUp size={16} /></button>
            <button className="iconbtn" aria-label="Move down" title="Move down" disabled={index >= tasks.length - 1} onClick={() => void patch({ position: index + 1 })}><ArrowDown size={16} /></button>
          </span>
          <button
            className="btn"
            onClick={async () => {
              if (!window.confirm(task.summary ? "Delete this task and its subtasks? Time logged on them stays on the project." : "Delete this task? Time logged on it stays on the project.")) return;
              try {
                await api(`/api/projects/${project.id}/tasks/${task.id}`, { method: "DELETE" });
                onDeleted();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </div>
    </aside>
  );
}

function DraftDialog({ project, onClose, onAdded }: { project: Project; onClose: () => void; onAdded: (t: Task[]) => void }) {
  const [plan, setPlan] = useState<DraftPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [start, setStart] = useState(project.start && project.start > todayStr() ? project.start : todayStr());
  const [notes, setNotes] = useState("");

  const draft = async () => {
    setBusy(true);
    setError("");
    try {
      setPlan(await api<DraftPlan>(`/api/projects/${project.id}/plan/draft`, { method: "POST", json: { notes } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Draft a plan" onClose={onClose} wide>
      <div className="form">
        <p className="muted">The suite&apos;s AI model drafts phases and tasks from the project&apos;s name and description. Look it over before adding it.</p>
        <label><span>Anything else it should know</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Team size, deadlines, what's already done" /></label>
        {plan && (
          <div className="tablewrap" style={{ maxHeight: 300, overflowY: "auto" }}>
            <table className="grid">
              <thead><tr><th>Task</th><th className="num">Days</th><th className="num">Hours</th></tr></thead>
              <tbody>
                {plan.phases.flatMap((ph, i) => [
                  <tr key={`p${i}`} className="summary"><td colSpan={3}><b>{ph.title}</b></td></tr>,
                  ...ph.tasks.map((t, j) => (
                    <tr key={`t${i}-${j}`}><td style={{ paddingLeft: 24 }}>{t.milestone ? "◆ " : ""}{t.title}</td><td className="num">{t.milestone ? "" : t.durationDays}</td><td className="num">{t.estimateHours ?? ""}</td></tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        )}
        {plan && <label><span>Start the plan on</span><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>}
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className={`btn${plan ? "" : " primary"}`} onClick={() => void draft()} disabled={busy}>{busy ? "Drafting…" : plan ? "Draft again" : "Draft"}</button>
          {plan && (
            <button
              className="btn primary"
              disabled={busy || !plan.phases.length}
              onClick={async () => {
                setBusy(true);
                try {
                  onAdded(await api<Task[]>(`/api/projects/${project.id}/plan`, { method: "POST", json: { start, phases: plan.phases } }));
                } catch (e) {
                  setError((e as Error).message);
                  setBusy(false);
                }
              }}
            >
              Add to plan
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
