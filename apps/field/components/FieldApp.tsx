"use client";
import { CalendarClock, ClipboardList, Settings as Cog, Smartphone, Users, Building2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BoardView } from "./Board";
import { CustomersView } from "./Customers";
import { JobsView } from "./Jobs";
import { TeamView } from "./Team";
import { WorkOrderPanel } from "./WorkOrderPanel";
import { type Role, type Staff, type Status, api } from "./client";

type View = "board" | "jobs" | "customers" | "team";

export type Ctx = {
  me: { email: string; name: string };
  status: Status;
  staff: Staff[];
  reloadStaff: () => Promise<void>;
  reloadStatus: () => Promise<void>;
  openJob: (id: string) => void;
  /** Bumped whenever a job changes, so lists refresh. */
  version: number;
  changed: () => void;
};

export function FieldApp({ me, role }: { me: { email: string; name: string }; role: Role | null }) {
  const [view, setView] = useState<View>("board");
  const [status, setStatus] = useState<Status | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [job, setJob] = useState<string | null>(null);
  const [customer, setCustomer] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");

  const reloadStatus = useCallback(async () => setStatus(await api<Status>("/api/status")), []);
  const reloadStaff = useCallback(async () => setStaff(await api<Staff[]>("/api/staff")), []);

  useEffect(() => {
    if (!role) return;
    Promise.all([reloadStatus(), reloadStaff()]).catch((e) => setError((e as Error).message));
    const p = new URLSearchParams(window.location.search);
    if (p.get("job")) setJob(p.get("job"));
    if (p.get("customer")) {
      setCustomer(p.get("customer"));
      setView("customers");
    }
  }, [role, reloadStatus, reloadStaff]);

  const openJob = useCallback((id: string) => {
    setJob(id);
    const u = new URL(window.location.href);
    u.searchParams.set("job", id);
    window.history.replaceState(null, "", u);
  }, []);

  const closeJob = () => {
    setJob(null);
    const u = new URL(window.location.href);
    u.searchParams.delete("job");
    window.history.replaceState(null, "", u);
  };

  if (!role) {
    return (
      <div className="pad">
        <h1>Field Service</h1>
        <p className="muted">You&apos;re not on the field service team yet. Ask a dispatcher to add you.</p>
      </div>
    );
  }
  if (error) return <div className="pad error">{error}</div>;
  if (!status) return <div className="pad muted">Loading…</div>;

  const ctx: Ctx = { me, status, staff, reloadStaff, reloadStatus, openJob, version, changed: () => setVersion((v) => v + 1) };
  const nav: [View, string, React.ReactNode][] = [
    ["board", "Schedule board", <CalendarClock key="b" size={18} />],
    ["jobs", "Work orders", <ClipboardList key="j" size={18} />],
    ["customers", "Customers and assets", <Building2 key="c" size={18} />],
    ["team", "Team and settings", <Users key="t" size={18} />],
  ];
  return (
    <div className="app">
      <nav className="nav">
        {nav.map(([id, label, icon]) => (
          <button key={id} className={`navitem${view === id ? " active" : ""}`} onClick={() => setView(id)}>
            {icon}
            {label}
          </button>
        ))}
        <a className="navitem" href="/tech">
          <Smartphone size={18} />
          Technician view
        </a>
        <div className="navsection">Links</div>
        <LinkRow label="Commerce parts" on={status.links.commerce} extra={status.parts.failed ? `${status.parts.failed} waiting` : ""} />
        <LinkRow label="Books billing" on={status.links.books} />
        <LinkRow label="Desk cases" on={status.links.desk} />
        <LinkRow label="Ops assets" on={status.links.ops} />
        <LinkRow label="AI steps" on={status.ai} />
        <div className="grow" />
        <button className="navitem small muted" onClick={() => setView("team")}>
          <Cog size={14} /> {status.settings.timeZone}
        </button>
      </nav>
      <main className="main">
        {view === "board" && <BoardView ctx={ctx} />}
        {view === "jobs" && <JobsView ctx={ctx} />}
        {view === "customers" && <CustomersView ctx={ctx} initial={customer} />}
        {view === "team" && <TeamView ctx={ctx} />}
      </main>
      {job && <WorkOrderPanel ctx={ctx} id={job} onClose={closeJob} />}
    </div>
  );
}

function LinkRow({ label, on, extra }: { label: string; on: boolean; extra?: string }) {
  return (
    <div className="linkrow" title={on ? "Linked" : "Not linked: set its token"}>
      <span className={`dot${on ? " on" : ""}`} />
      <span className="grow">{label}</span>
      {extra ? <span className="pill on_hold">{extra}</span> : null}
    </div>
  );
}
