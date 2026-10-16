"use client";
import { ExternalLink, Settings, Trash2, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ProjectReport } from "@/lib/reports";
import type { Expense, Member, Project, TimeEntry } from "@/lib/types";
import { BILLING_LABELS, STATUS_LABELS } from "@/lib/types";
import { BillingTab } from "./BillingTab";
import { amount, api, hrs, hrsLabel, money, person, shortDate, todayStr } from "./client";
import { Confirm } from "./Modal";
import { PlanTab } from "./PlanTab";
import { ProjectDialog } from "./ProjectDialog";
import type { AppStatus, Me } from "./ProjectsApp";

type Tab = "overview" | "plan" | "team" | "time" | "expenses" | "billing";

export function ProjectView({ id, me, status, focusTask, onChange, onDeleted }: {
  id: string; me: Me; status: AppStatus; focusTask?: string; onChange: () => void; onDeleted: () => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>(focusTask ? "plan" : "overview");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [planner, setPlanner] = useState<{ board: string | null; cards: Record<string, string> }>({ board: null, cards: {} });

  const load = useCallback(async () => {
    try {
      setProject(await api<Project>(`/api/projects/${id}`));
      setPlanner(await api(`/api/projects/${id}/planner`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="pad error">{error}</p>;
  if (!project) return <p className="pad muted">Loading…</p>;
  const manager = project.myRole === "manager";
  const tabs: [Tab, string][] = [["overview", "Overview"], ["plan", "Plan"], ["team", "Team"], ["time", "Time"], ["expenses", "Expenses"]];
  if (manager && project.billing !== "none") tabs.push(["billing", "Billing"]);

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1><span className="muted">{project.code}</span> {project.name}</h1>
          <p className="sub muted">
            <span className={`pill ${project.status}`}>{STATUS_LABELS[project.status]}</span>{" "}
            {project.clientName && <>for {project.clientName} · </>}
            {BILLING_LABELS[project.billing]}
            {project.start && <> · {shortDate(project.start)} to {shortDate(project.finish)}</>}
          </p>
        </div>
        {planner.board && (
          <a className="btn" href={planner.board} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Planner board</a>
        )}
        {manager && (
          <>
            <button className="btn" onClick={() => setEditing(true)}><Settings size={15} /> Settings</button>
            <button className="iconbtn" aria-label="Delete project" title="Delete project" onClick={() => setDeleting(true)}><Trash2 size={17} /></button>
          </>
        )}
      </div>
      <div className="tabs" role="tablist">
        {tabs.map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>
      {tab === "overview" && <Overview project={project} me={me} />}
      {tab === "plan" && <PlanTab project={project} status={status} cardLinks={planner.cards} focusTask={focusTask} onPlannerSync={load} />}
      {tab === "team" && <TeamTab project={project} me={me} onChange={(p) => { setProject(p); onChange(); }} onLeft={onDeleted} />}
      {tab === "time" && <TimeTab project={project} me={me} />}
      {tab === "expenses" && <ExpensesTab project={project} me={me} />}
      {tab === "billing" && <BillingTab project={project} status={status} />}
      {editing && (
        <ProjectDialog
          project={project}
          onClose={() => setEditing(false)}
          onSaved={(p) => {
            setEditing(false);
            setProject(p);
            void load();
            onChange();
          }}
        />
      )}
      {deleting && (
        <Confirm
          title="Delete project"
          danger
          action="Delete"
          message={<>Delete <b>{project.name}</b> with its plan, time and expenses? Invoices already in Books stay there.</>}
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await api(`/api/projects/${id}`, { method: "DELETE" });
            onDeleted();
          }}
        />
      )}
    </>
  );
}

function Overview({ project, me }: { project: Project; me: Me }) {
  const [r, setR] = useState<ProjectReport | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<ProjectReport>(`/api/projects/${project.id}/report?today=${todayStr()}`).then(setR).catch((e) => setError((e as Error).message));
  }, [project.id]);
  if (error) return <p className="pad error">{error}</p>;
  if (!r) return <p className="pad muted">Loading…</p>;
  const max = Math.max(1, ...r.weeks.map((w) => w.minutes));
  const budget = r.hours.budget;
  const m = r.money;
  const cur = project.currency;
  return (
    <div className="body">
      <div className="kpis">
        <div className="kpi">
          <span className="muted">Done</span><b>{r.percentDone}%</b>
          <div className="meter"><div style={{ width: `${r.percentDone}%` }} /></div>
        </div>
        <div className="kpi">
          <span className="muted">Tasks</span><b>{r.tasks.done} of {r.tasks.total}</b>
          <span className={r.tasks.late ? "error small" : "muted"}>{r.tasks.late ? `${r.tasks.late} late` : "None late"}</span>
        </div>
        <div className="kpi">
          <span className="muted">Hours logged</span><b>{hrsLabel(r.hours.total)}</b>
          {budget ? (
            <>
              <span className="muted">of {hrsLabel(budget)} budget</span>
              <div className="meter"><div className={r.hours.total > budget ? "over" : ""} style={{ width: `${Math.min(100, (r.hours.total / budget) * 100)}%` }} /></div>
            </>
          ) : <span className="muted">{hrsLabel(r.hours.approved)} approved</span>}
        </div>
        {m && (
          <>
            <div className="kpi"><span className="muted">Billed</span><b>{money(m.billedCents, cur)}</b><span className="muted">{money(m.unbilledCents, cur)} ready to bill</span></div>
            <div className="kpi">
              <span className="muted">Cost</span><b>{money(m.costCents, cur)}</b>
              {m.budgetCents ? (
                <>
                  <span className="muted">of {money(m.budgetCents, cur)} budget</span>
                  <div className="meter"><div className={m.costCents > m.budgetCents ? "over" : ""} style={{ width: `${Math.min(100, (m.costCents / m.budgetCents) * 100)}%` }} /></div>
                </>
              ) : <span className="muted">{money(m.expensesCents, cur)} in expenses</span>}
            </div>
            <div className="kpi"><span className="muted">Waiting for approval</span><b>{money(m.awaitingApprovalCents, cur)}</b><span className="muted">{hrsLabel(r.hours.submitted)} submitted</span></div>
          </>
        )}
      </div>
      {project.description && <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{project.description}</p>}
      <section>
        <h2>Hours by week</h2>
        <div className="bars" aria-label="Hours logged each week, last 12 weeks">
          {r.weeks.map((w) => (
            <div key={w.week} title={`Week of ${shortDate(w.week)}: ${hrsLabel(w.minutes)}`}>
              <span style={{ height: `${(w.minutes / max) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="barlabels">{r.weeks.map((w, i) => <span key={w.week}>{i % 2 === 1 ? shortDate(w.week) : ""}</span>)}</div>
      </section>
      <section>
        <h2>Team this week</h2>
        <div className="tablewrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Person</th><th className="num">This week (all projects)</th><th className="num">Capacity</th>
                <th className="num">Assigned work left</th><th className="num">Logged here</th>
                {m && <><th className="num">Cost</th><th className="num">Billable value</th></>}
              </tr>
            </thead>
            <tbody>
              {r.people.map((p) => (
                <tr key={p.email}>
                  <td>{person(p.email, me.email)}</td>
                  <td className={`num${p.thisWeek > p.weeklyMinutes ? " error" : ""}`}>{hrsLabel(p.thisWeek)}</td>
                  <td className="num">{hrsLabel(p.weeklyMinutes)}</td>
                  <td className="num">{hrsLabel(p.assignedMinutes)}</td>
                  <td className="num">{hrsLabel(p.minutes)}</td>
                  {m && <><td className="num">{money(p.costCents, cur)}</td><td className="num">{money(p.valueCents, cur)}</td></>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function TeamTab({ project, me, onChange, onLeft }: { project: Project; me: Me; onChange: (p: Project) => void; onLeft: () => void }) {
  const manager = project.myRole === "manager";
  const [error, setError] = useState("");
  const save = async (body: Record<string, unknown>) => {
    setError("");
    try {
      onChange(await api<Project>(`/api/projects/${project.id}/members`, { method: "POST", json: body }));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const remove = async (m: Member) => {
    setError("");
    try {
      await api(`/api/projects/${project.id}/members?email=${encodeURIComponent(m.email)}`, { method: "DELETE" });
      if (m.email === me.email) onLeft();
      else onChange(await api<Project>(`/api/projects/${project.id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="body">
      {manager && (
        <form
          className="toolbar"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            if (await save({ email: f.get("email"), role: f.get("role"), billRate: f.get("billRate"), costRate: f.get("costRate") })) form.reset();
          }}
        >
          <input className="cellin" name="email" type="email" placeholder="Email address" required style={{ width: 240 }} />
          <select className="cellin" name="role" defaultValue="member"><option value="member">Member</option><option value="manager">Manager</option></select>
          <input className="cellin" name="billRate" inputMode="decimal" placeholder="Bill rate / h" style={{ width: 110 }} />
          <input className="cellin" name="costRate" inputMode="decimal" placeholder="Cost rate / h" style={{ width: 110 }} />
          <button className="btn primary"><UserPlus size={15} /> Add to team</button>
        </form>
      )}
      <p className="error" role="alert">{error}</p>
      <div className="tablewrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Person</th><th>Role</th><th className="num">Hours a week</th>
              {manager && <><th className="num">Bill rate / h</th><th className="num">Cost rate / h</th></>}
              <th />
            </tr>
          </thead>
          <tbody>
            {project.members.map((m) => (
              <tr key={m.email}>
                <td>{person(m.email, me.email)} <span className="muted small">{m.email}</span></td>
                <td>
                  {manager ? (
                    <select className="cellin" value={m.role} onChange={(e) => void save({ email: m.email, role: e.target.value })}>
                      <option value="member">Member</option><option value="manager">Manager</option>
                    </select>
                  ) : m.role === "manager" ? "Manager" : "Member"}
                </td>
                <td className="num">
                  {manager ? (
                    <input className="cellin" style={{ width: 70, textAlign: "right" }} defaultValue={hrs(m.weeklyMinutes)}
                      onBlur={(e) => e.target.value !== hrs(m.weeklyMinutes) && void save({ email: m.email, weeklyHours: e.target.value })} />
                  ) : hrs(m.weeklyMinutes)}
                </td>
                {manager && (
                  <>
                    <td className="num">
                      <input className="cellin" style={{ width: 90, textAlign: "right" }} defaultValue={amount(m.billRateCents)}
                        placeholder={project.defaultRateCents ? amount(project.defaultRateCents) : ""}
                        onBlur={(e) => e.target.value !== amount(m.billRateCents) && void save({ email: m.email, billRate: e.target.value })} />
                    </td>
                    <td className="num">
                      <input className="cellin" style={{ width: 90, textAlign: "right" }} defaultValue={amount(m.costRateCents)}
                        onBlur={(e) => e.target.value !== amount(m.costRateCents) && void save({ email: m.email, costRate: e.target.value })} />
                    </td>
                  </>
                )}
                <td className="num">
                  {(manager || m.email === me.email) && (
                    <button className="iconbtn small" aria-label={m.email === me.email ? "Leave project" : `Remove ${m.email}`} title={m.email === me.email ? "Leave project" : "Remove"} onClick={() => void remove(m)}>
                      <X size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {manager && <p className="muted small">An empty bill rate uses the project&apos;s default rate. Rates are fixed on time when it is approved.</p>}
    </div>
  );
}

function entryStatus(e: { status: string; invoiced: boolean }) {
  return e.invoiced ? <span className="pill billed">Billed</span> : <span className={`pill ${e.status}`}>{e.status[0].toUpperCase() + e.status.slice(1)}</span>;
}

function TimeTab({ project, me }: { project: Project; me: Me }) {
  const [rows, setRows] = useState<TimeEntry[] | null>(null);
  const [error, setError] = useState("");
  const manager = project.myRole === "manager";
  const load = useCallback(() => {
    api<TimeEntry[]>(`/api/projects/${project.id}/time`).then(setRows).catch((e) => setError((e as Error).message));
  }, [project.id]);
  useEffect(load, [load]);
  if (!rows) return <p className="pad muted">{error || "Loading…"}</p>;
  const total = rows.reduce((s, r) => s + r.minutes, 0);
  return (
    <div className="body">
      <p className="muted" style={{ margin: 0 }}>{manager ? "Everyone's time on this project." : "Your time on this project."} Log time from <a className="linkbtn" href="?view=timesheet">your timesheet</a>.</p>
      <p className="error" role="alert">{error}</p>
      {!rows.length ? <div className="empty">No time logged yet.</div> : (
        <div className="tablewrap">
          <table className="grid">
            <thead><tr><th>Day</th><th>Person</th><th>Task</th><th>Notes</th><th className="num">Hours</th><th>Billable</th><th>Status</th>{manager && <th />}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{shortDate(r.day)}</td>
                  <td>{person(r.person, me.email)}</td>
                  <td>{r.taskTitle ?? <span className="muted">General</span>}</td>
                  <td className="muted">{r.notes}{r.rejectReason && <span className="error"> Sent back: {r.rejectReason}</span>}</td>
                  <td className="num">{hrs(r.minutes)}</td>
                  <td>{r.billable ? "Yes" : "No"}</td>
                  <td>{entryStatus(r)}</td>
                  {manager && (
                    <td>
                      {r.status === "approved" && !r.invoiced && (
                        <button className="linkbtn" onClick={async () => {
                          try {
                            await api("/api/approvals", { method: "POST", json: { reopen: true, time: [r.id] } });
                            load();
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}>Reopen</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4}>Total</td><td className="num">{hrs(total)}</td><td colSpan={manager ? 3 : 2} /></tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function ExpensesTab({ project, me }: { project: Project; me: Me }) {
  const [rows, setRows] = useState<Expense[] | null>(null);
  const [error, setError] = useState("");
  const manager = project.myRole === "manager";
  const load = useCallback(() => {
    api<Expense[]>(`/api/projects/${project.id}/expenses`).then(setRows).catch((e) => setError((e as Error).message));
  }, [project.id]);
  useEffect(load, [load]);
  if (!rows) return <p className="pad muted">{error || "Loading…"}</p>;
  return (
    <div className="body">
      <p className="muted" style={{ margin: 0 }}>{manager ? "Everyone's expenses on this project." : "Your expenses on this project."} Add them from <a className="linkbtn" href="?view=expenses">your expenses</a>.</p>
      <p className="error" role="alert">{error}</p>
      {!rows.length ? <div className="empty">No expenses yet.</div> : (
        <div className="tablewrap">
          <table className="grid">
            <thead><tr><th>Day</th><th>Person</th><th>Category</th><th>Description</th><th className="num">Amount</th><th>Billable</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{shortDate(r.day)}</td>
                  <td>{person(r.person, me.email)}</td>
                  <td>{r.category}</td>
                  <td className="muted">{r.description}</td>
                  <td className="num">{money(r.amountCents, project.currency)}</td>
                  <td>{r.billable ? "Yes" : "No"}</td>
                  <td>{entryStatus(r)}</td>
                  <td>
                    {r.receiptName && <a className="linkbtn" href={`/api/expenses/${r.id}/receipt`} target="_blank" rel="noreferrer">Receipt</a>}
                    {manager && r.status === "approved" && !r.invoiced && (
                      <button className="linkbtn" onClick={async () => {
                        try {
                          await api("/api/approvals", { method: "POST", json: { reopen: true, expenses: [r.id] } });
                          load();
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}>Reopen</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
