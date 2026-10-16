"use client";
// The Admin center: navigation on the left, the chosen section on the right. Where you are lives
// in the address (#/matters/<id>/holds) so reloading and the back button work.
import {
  Activity, AppWindow, Briefcase, ExternalLink, Gavel, History, House, Import, KeyRound, Search, Timer, Users,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { Me } from "@/lib/types";
import { Apps } from "./Apps";
import { Audit } from "./Audit";
import { useRoute, type View } from "./client";
import { Holds } from "./Holds";
import { Home } from "./Home";
import { MatterView, Matters } from "./Matters";
import { Migrate } from "./Migrate";
import { People } from "./People";
import { Retention } from "./Retention";
import { Roles } from "./Roles";
import { SearchView } from "./Search";
import type { AppCtx, AppInfo } from "./shared";

type Item = { view: View; text: string; icon: React.ReactNode; admin?: boolean };

const GENERAL: Item[] = [
  { view: "home", text: "Home", icon: <House size={18} />, admin: true },
  { view: "people", text: "People", icon: <Users size={18} />, admin: true },
  { view: "apps", text: "Apps", icon: <AppWindow size={18} />, admin: true },
  { view: "migrate", text: "Move from Microsoft 365", icon: <Import size={18} />, admin: true },
];
const COMPLIANCE: Item[] = [
  { view: "matters", text: "Matters", icon: <Briefcase size={18} /> },
  { view: "holds", text: "Holds", icon: <Gavel size={18} /> },
  { view: "search", text: "Content search", icon: <Search size={18} /> },
  { view: "retention", text: "Retention", icon: <Timer size={18} /> },
];
const SETTINGS: Item[] = [
  { view: "audit", text: "Audit log", icon: <History size={18} />, admin: true },
  { view: "roles", text: "Roles", icon: <KeyRound size={18} />, admin: true },
];

export function AdminApp({ me, roleLabel, authConsole, apps }: { me: Me; roleLabel: string; authConsole: string; apps: AppInfo[] }) {
  const admin = me.role === "admin";
  const [route, go] = useRoute(admin ? "home" : "matters");
  const [toast, setToast] = useState("");

  const say = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((t) => (t === text ? "" : t)), 5000);
  }, []);

  const app: AppCtx = useMemo(() => ({ me, apps, authConsole, go, say }), [me, apps, authConsole, go, say]);
  const allowed = (items: Item[]) => items.filter((i) => admin || !i.admin);
  const view = !admin && [...GENERAL, ...SETTINGS].some((i) => i.view === route.view) ? "matters" : route.view;

  const link = (n: Item) => (
    <a key={n.view} href={`#/${n.view}`} className={`navitem${view === n.view ? " active" : ""}`} aria-current={view === n.view ? "page" : undefined}>
      {n.icon} {n.text}
    </a>
  );

  return (
    <div className="admin">
      <nav className="nav" aria-label="Admin center">
        {allowed(GENERAL).map(link)}
        <div className="navsection">Compliance</div>
        {COMPLIANCE.map(link)}
        {admin ? <div className="navsection">Settings</div> : null}
        {allowed(SETTINGS).map(link)}
        {admin ? (
          <a className="navitem" href={authConsole} target="_blank" rel="noreferrer" title="MFA, sign-in apps, keys and the sign-in audit log">
            <Activity size={18} /> Sign-in console <ExternalLink size={14} className="ext" />
          </a>
        ) : null}
        <span className="grow" />
        <div className="whoami small">
          <span className="rname">{me.name}</span>
          <span className="muted">{roleLabel}</span>
        </div>
      </nav>
      <main className="view">
        {view === "home" ? <Home app={app} />
          : view === "people" ? <People app={app} />
          : view === "apps" ? <Apps app={app} />
          : view === "migrate" ? <Migrate app={app} id={route.id} tab={route.tab} />
          : view === "matters" ? (route.id ? <MatterView key={route.id} app={app} id={route.id} tab={route.tab} /> : <Matters app={app} />)
          : view === "holds" ? <Holds app={app} />
          : view === "search" ? <SearchView key={route.id ?? "new"} app={app} savedId={route.id} />
          : view === "retention" ? <Retention app={app} />
          : view === "audit" ? <Audit app={app} />
          : <Roles app={app} />}
      </main>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}
