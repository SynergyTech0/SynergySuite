"use client";
import { BookOpenCheck, Briefcase, CalendarClock, Clock, Landmark, LayoutDashboard, Plus, ShieldAlert, User, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "./client";
import { ClientsView, ClientView } from "./Clients";
import { ConflictsView } from "./Conflicts";
import { Dashboard } from "./Dashboard";
import { DeadlinesView } from "./Deadlines";
import { MatterList, NewMatter } from "./Matters";
import { MatterView } from "./MatterView";
import { RulesView } from "./Rules";
import { TimeView } from "./TimeView";
import { TrustView } from "./Trust";
import type { AppInfo, Me } from "./types";

type Page = "dashboard" | "mine" | "all" | "clients" | "conflicts" | "deadlines" | "time" | "trust" | "rules";
type View = { kind: "page"; page: Page } | { kind: "matter"; id: string; tab?: string; doc?: string } | { kind: "client"; id: string };

const PAGES: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: "dashboard", label: "Overview", icon: <LayoutDashboard size={17} /> },
  { id: "mine", label: "My matters", icon: <User size={17} /> },
  { id: "all", label: "All matters", icon: <Briefcase size={17} /> },
  { id: "clients", label: "Clients", icon: <Users size={17} /> },
  { id: "conflicts", label: "Conflict checks", icon: <ShieldAlert size={17} /> },
  { id: "deadlines", label: "Deadlines", icon: <CalendarClock size={17} /> },
  { id: "time", label: "My time", icon: <Clock size={17} /> },
  { id: "trust", label: "Trust accounts", icon: <Landmark size={17} /> },
  { id: "rules", label: "State rules", icon: <BookOpenCheck size={17} /> },
];

function fromUrl(): View {
  const s = new URLSearchParams(window.location.search);
  const m = s.get("matter");
  if (m) return { kind: "matter", id: m, tab: s.get("tab") ?? undefined, doc: s.get("doc") ?? undefined };
  const c = s.get("client");
  if (c) return { kind: "client", id: c };
  const p = s.get("view") as Page | null;
  if (p && PAGES.some((x) => x.id === p)) return { kind: "page", page: p };
  return { kind: "page", page: "dashboard" };
}

function toUrl(v: View): string {
  if (v.kind === "matter") return `?matter=${v.id}${v.tab ? `&tab=${v.tab}` : ""}`;
  if (v.kind === "client") return `?client=${v.id}`;
  return v.page === "dashboard" ? "/" : `?view=${v.page}`;
}

export type Go = {
  matter: (id: string, tab?: string) => void;
  client: (id: string) => void;
  page: (p: Page) => void;
};

export function LawApp({ me }: { me: Me }) {
  const [view, setView] = useState<View>({ kind: "page", page: "dashboard" });
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [creating, setCreating] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    setView(fromUrl());
    const onPop = () => setView(fromUrl());
    window.addEventListener("popstate", onPop);
    api<AppInfo>("/api/me").then(setInfo).catch(() => {});
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const nav = (v: View) => {
    setView(v);
    window.history.pushState(null, "", toUrl(v));
  };
  const go: Go = {
    matter: (id, tab) => nav({ kind: "matter", id, tab }),
    client: (id) => nav({ kind: "client", id }),
    page: (page) => nav({ kind: "page", page }),
  };
  const on = (p: Page) => (view.kind === "page" && view.page === p ? " active" : "");

  return (
    <div className="app">
      <nav className="nav" aria-label="Law">
        <button className="btn primary newbtn" onClick={() => setCreating(true)}>
          <Plus size={16} /> New matter
        </button>
        {PAGES.filter((p) => p.id !== "trust" || info?.trustKeeper || info?.admin).map((p) => (
          <button key={p.id} className={`navitem${on(p.id)}`} onClick={() => go.page(p.id)}>
            {p.icon} <span className="grow">{p.label}</span>
          </button>
        ))}
      </nav>
      <main className="main">
        {!info ? (
          <p className="pad muted">Loading…</p>
        ) : view.kind === "matter" ? (
          <MatterView key={`${view.id}-${tick}`} id={view.id} tab={view.tab} doc={view.doc} info={info} go={go} onChange={refresh} />
        ) : view.kind === "client" ? (
          <ClientView key={`${view.id}-${tick}`} id={view.id} info={info} go={go} />
        ) : view.page === "dashboard" ? (
          <Dashboard key={tick} me={me} info={info} go={go} onNew={() => setCreating(true)} />
        ) : view.page === "mine" || view.page === "all" ? (
          <MatterList key={`${view.page}-${tick}`} view={view.page} info={info} go={go} />
        ) : view.page === "clients" ? (
          <ClientsView key={tick} info={info} go={go} />
        ) : view.page === "conflicts" ? (
          <ConflictsView key={tick} info={info} go={go} />
        ) : view.page === "deadlines" ? (
          <DeadlinesView key={tick} info={info} go={go} />
        ) : view.page === "time" ? (
          <TimeView key={tick} info={info} go={go} />
        ) : view.page === "trust" ? (
          <TrustView key={tick} info={info} go={go} />
        ) : (
          <RulesView info={info} />
        )}
      </main>
      {creating && info && (
        <NewMatter
          info={info}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            refresh();
            go.matter(id);
          }}
        />
      )}
    </div>
  );
}
