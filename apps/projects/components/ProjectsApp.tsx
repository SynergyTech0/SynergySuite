"use client";
import { CheckCheck, Clock, FolderKanban, LayoutList, Plus, Receipt } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ProjectSummary } from "@/lib/types";
import { STATUS_LABELS } from "@/lib/types";
import { Approvals } from "./Approvals";
import { api, hrsLabel, shortDate, todayStr } from "./client";
import { Expenses } from "./Expenses";
import { ProjectDialog } from "./ProjectDialog";
import { ProjectView } from "./ProjectView";
import { Timesheet } from "./Timesheet";

export type Me = { email: string; name: string };
export type AppStatus = { ai: boolean; books: boolean; booksUrl: string };
type View = { kind: "list" } | { kind: "timesheet" } | { kind: "expenses" } | { kind: "approvals" } | { kind: "project"; id: string; task?: string };

function fromUrl(): View {
  const s = new URLSearchParams(window.location.search);
  const project = s.get("project");
  if (project) return { kind: "project", id: project, task: s.get("task") ?? undefined };
  const v = s.get("view");
  if (v === "timesheet" || v === "expenses" || v === "approvals") return { kind: v };
  return { kind: "list" };
}

function toUrl(v: View): string {
  if (v.kind === "project") return `?project=${v.id}`;
  if (v.kind === "list") return "/";
  return `?view=${v.kind}`;
}

export function ProjectsApp({ me }: { me: Me }) {
  const [view, setView] = useState<View>({ kind: "list" });
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [status, setStatus] = useState<AppStatus>({ ai: false, books: false, booksUrl: "" });
  const [waiting, setWaiting] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setProjects(await api<ProjectSummary[]>(`/api/projects?today=${todayStr()}`));
      const a = await api<{ time: unknown[]; expenses: unknown[] }>("/api/approvals");
      setWaiting(a.time.length + a.expenses.length);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    setView(fromUrl());
    const onPop = () => setView(fromUrl());
    window.addEventListener("popstate", onPop);
    void refresh();
    api<AppStatus>("/api/status").then(setStatus).catch(() => {});
    return () => window.removeEventListener("popstate", onPop);
  }, [refresh]);

  const go = (v: View) => {
    setView(v);
    window.history.pushState(null, "", toUrl(v));
  };

  const active = (k: View["kind"], id?: string) => (view.kind === k && (!id || (view.kind === "project" && view.id === id)) ? " active" : "");
  const open = (projects ?? []).filter((p) => p.status !== "done" && p.status !== "cancelled");

  return (
    <div className="app">
      <nav className="nav" aria-label="Projects">
        <button className="btn primary newbtn" onClick={() => setCreating(true)}>
          <Plus size={16} /> New project
        </button>
        <button className={`navitem${active("list")}`} onClick={() => go({ kind: "list" })}>
          <LayoutList size={17} /> All projects
        </button>
        <button className={`navitem${active("timesheet")}`} onClick={() => go({ kind: "timesheet" })}>
          <Clock size={17} /> My timesheet
        </button>
        <button className={`navitem${active("expenses")}`} onClick={() => go({ kind: "expenses" })}>
          <Receipt size={17} /> My expenses
        </button>
        <button className={`navitem${active("approvals")}`} onClick={() => go({ kind: "approvals" })}>
          <CheckCheck size={17} /> <span className="grow">Approvals</span>
          {waiting > 0 && <span className="count">{waiting}</span>}
        </button>
        <div className="navsection">Active</div>
        {open.map((p) => (
          <button key={p.id} className={`navitem${active("project", p.id)}`} onClick={() => go({ kind: "project", id: p.id })}>
            <FolderKanban size={17} />
            <span className="fname">{p.name}</span>
            <span className="code">{p.code}</span>
          </button>
        ))}
        {projects && !open.length && <p className="muted small" style={{ padding: "0 10px" }}>No active projects yet.</p>}
      </nav>
      <main className="main">
        {error && <p className="error pad">{error}</p>}
        {view.kind === "list" && <ProjectList projects={projects} onOpen={(id) => go({ kind: "project", id })} onNew={() => setCreating(true)} />}
        {view.kind === "timesheet" && <Timesheet me={me} onChange={refresh} />}
        {view.kind === "expenses" && <Expenses me={me} projects={projects ?? []} />}
        {view.kind === "approvals" && <Approvals me={me} onChange={refresh} />}
        {view.kind === "project" && (
          <ProjectView
            key={view.id}
            id={view.id}
            me={me}
            status={status}
            focusTask={view.task}
            onChange={refresh}
            onDeleted={() => {
              void refresh();
              go({ kind: "list" });
            }}
          />
        )}
      </main>
      {creating && (
        <ProjectDialog
          onClose={() => setCreating(false)}
          onSaved={(p) => {
            setCreating(false);
            void refresh();
            go({ kind: "project", id: p.id });
          }}
        />
      )}
    </div>
  );
}

function ProjectList({ projects, onOpen, onNew }: { projects: ProjectSummary[] | null; onOpen: (id: string) => void; onNew: () => void }) {
  if (!projects) return <p className="pad muted">Loading…</p>;
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Projects</h1>
          <p className="sub muted">Plans, team time, expenses and billing for every project you are on.</p>
        </div>
      </div>
      <div className="body">
        {!projects.length ? (
          <div className="empty">
            <p>You aren&apos;t on any projects yet.</p>
            <button className="btn primary" onClick={onNew}><Plus size={16} /> New project</button>
          </div>
        ) : (
          <div className="tablewrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Project</th><th>Client</th><th>Status</th><th>Your role</th><th>Dates</th>
                  <th className="num">Done</th><th className="num">Open tasks</th><th className="num">Hours</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="click" onClick={() => onOpen(p.id)}>
                    <td><span className="muted small">{p.code}</span> {p.name}</td>
                    <td>{p.clientName}</td>
                    <td><span className={`pill ${p.status}`}>{STATUS_LABELS[p.status]}</span></td>
                    <td>{p.myRole === "manager" ? "Manager" : "Member"}</td>
                    <td className="muted">{p.start ? `${shortDate(p.start)} – ${shortDate(p.finish)}` : ""}</td>
                    <td className="num">{p.percentDone}%</td>
                    <td className="num">{p.openTasks}{p.lateTasks ? <span className="error"> ({p.lateTasks} late)</span> : null}</td>
                    <td className="num">{hrsLabel(p.loggedMinutes)}{p.budgetMinutes ? <span className="muted"> / {hrsLabel(p.budgetMinutes)}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
