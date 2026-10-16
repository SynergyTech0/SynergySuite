"use client";
import { CalendarDays, ClipboardCheck, Home as HomeIcon, Network, Users, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type Ctx, type Employee, type MeInfo, api } from "./client";
import { Home } from "./Home";
import { People } from "./People";
import { OrgChart } from "./OrgChart";
import { TimeOffView } from "./TimeOff";
import { Onboarding } from "./Onboarding";
import { Payroll } from "./Payroll";

const TABS = [
  { id: "home", label: "Home", icon: HomeIcon },
  { id: "people", label: "People", icon: Users },
  { id: "org", label: "Org chart", icon: Network },
  { id: "timeoff", label: "Time off", icon: CalendarDays },
  { id: "onboarding", label: "Onboarding", icon: ClipboardCheck },
  { id: "payroll", label: "Payroll", icon: Wallet },
] as const;

function readUrl(): { tab: string; person: string | null } {
  const p = new URLSearchParams(window.location.search);
  const person = p.get("person");
  return { tab: p.get("tab") || (person ? "people" : "home"), person };
}

export function HrApp() {
  const [me, setMe] = useState<MeInfo | null>(null);
  const [people, setPeople] = useState<Employee[]>([]);
  const [tab, setTab] = useState("home");
  const [person, setPerson] = useState<string | null>(null);
  const [toastMsg, setToast] = useState("");
  const [error, setError] = useState("");

  const reloadMe = useCallback(async () => setMe(await api<MeInfo>("/api/me")), []);
  const reloadPeople = useCallback(async () => setPeople(await api<Employee[]>("/api/employees")), []);

  useEffect(() => {
    const u = readUrl();
    setTab(u.tab);
    setPerson(u.person);
    Promise.all([reloadMe(), reloadPeople()]).catch((e) => setError((e as Error).message));
    const onPop = () => {
      const u2 = readUrl();
      setTab(u2.tab);
      setPerson(u2.person);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [reloadMe, reloadPeople]);

  const navigate = useCallback((t: string, p: string | null = null) => {
    setTab(t);
    setPerson(p);
    const q = new URLSearchParams();
    if (t !== "home") q.set("tab", t);
    if (p) q.set("person", p);
    window.history.pushState(null, "", q.toString() ? `/?${q}` : "/");
  }, []);

  const toast = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(""), 3000);
  }, []);

  if (error) return <div className="pad"><p className="error">{error}</p></div>;
  if (!me) return <div className="pad muted">Loading…</div>;

  const ctx: Ctx = {
    me, people, reloadMe, reloadPeople, toast,
    openPerson: (id) => navigate("people", id),
    go: (t) => navigate(t),
  };
  const visible = TABS.filter((t) => t.id !== "payroll" || me.roles.payrollAdmin);

  return (
    <div className="hr">
      <nav className="nav" aria-label="HR">
        {visible.map((t) => (
          <button key={t.id} className={`navitem${tab === t.id ? " active" : ""}`} onClick={() => navigate(t.id)}>
            <t.icon size={18} /> {t.label}
            {t.id === "onboarding" && me.openTasks > 0 && <span className="count">{me.openTasks}</span>}
          </button>
        ))}
      </nav>
      {tab === "home" && <Home ctx={ctx} />}
      {tab === "people" && <People ctx={ctx} selected={person} onSelect={(id) => navigate("people", id)} />}
      {tab === "org" && <OrgChart ctx={ctx} />}
      {tab === "timeoff" && <TimeOffView ctx={ctx} />}
      {tab === "onboarding" && <Onboarding ctx={ctx} />}
      {tab === "payroll" && me.roles.payrollAdmin && <Payroll ctx={ctx} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  );
}
