"use client";
// Devices: navigation on the left, the chosen section on the right. Admins get the whole fleet;
// everyone else gets My devices, their own computers and how to enroll one.
import {
  AppWindow, Bug, Crosshair, Fingerprint, History, Info, KeyRound, LayoutDashboard, Laptop, Monitor, ShieldAlert, ShieldCheck, SlidersHorizontal, Smartphone, TabletSmartphone, UserRound,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { About } from "./About";
import { AlertList, AlertView } from "./Alerts";
import { AndroidSetup } from "./Android";
import { AppleSetup } from "./Apple";
import { Apps } from "./Apps";
import { Audit } from "./Audit";
import { useRoute, type View } from "./client";
import { DeviceList } from "./DeviceList";
import { DeviceView } from "./DeviceView";
import { Enroll } from "./Enroll";
import { Hunting } from "./Hunting";
import { Indicators } from "./Indicators";
import { Overview } from "./Overview";
import { Policies } from "./Policies";
import { Profiles } from "./Profiles";
import type { AppCtx, Me } from "./shared";
import { Vulnerabilities } from "./Vulnerabilities";
import { WindowsSetup } from "./Windows";

type Item = { view: View; text: string; icon: React.ReactNode };

const MANAGE: Item[] = [
  { view: "overview", text: "Overview", icon: <LayoutDashboard size={18} /> },
  { view: "devices", text: "Devices", icon: <Laptop size={18} /> },
  { view: "compliance", text: "Compliance policies", icon: <ShieldCheck size={18} /> },
  { view: "profiles", text: "Configuration profiles", icon: <SlidersHorizontal size={18} /> },
  { view: "apps", text: "Apps", icon: <AppWindow size={18} /> },
  { view: "enroll", text: "Enrollment", icon: <KeyRound size={18} /> },
  { view: "apple", text: "Apple devices", icon: <Smartphone size={18} /> },
  { view: "android", text: "Android devices", icon: <TabletSmartphone size={18} /> },
  { view: "windows", text: "Windows devices", icon: <Monitor size={18} /> },
];
const SECURITY: Item[] = [
  { view: "alerts", text: "Alerts", icon: <ShieldAlert size={18} /> },
  { view: "vulnerabilities", text: "Vulnerabilities", icon: <Bug size={18} /> },
  { view: "hunting", text: "Live query", icon: <Crosshair size={18} /> },
  { view: "indicators", text: "Indicators", icon: <Fingerprint size={18} /> },
];
const MORE: Item[] = [
  { view: "my", text: "My devices", icon: <UserRound size={18} /> },
  { view: "audit", text: "Audit log", icon: <History size={18} /> },
  { view: "about", text: "About", icon: <Info size={18} /> },
];
const USER_VIEWS: View[] = ["my", "about", "devices", "alerts"];

export function DevicesApp({ me }: { me: Me }) {
  const admin = me.role === "admin";
  const [route, go] = useRoute(admin ? "overview" : "my");
  const [toast, setToast] = useState("");
  const say = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((t) => (t === text ? "" : t)), 5000);
  }, []);
  const app: AppCtx = useMemo(() => ({ me, go, say }), [me, go, say]);

  // People who aren't admins can open their own device and its alerts, nothing else.
  let view = route.view;
  if (!admin && (!USER_VIEWS.includes(view) || ((view === "devices" || view === "alerts") && !route.id))) view = "my";

  const link = (n: Item) => (
    <a key={n.view} href={`#/${n.view}`} className={`navitem${view === n.view ? " active" : ""}`} aria-current={view === n.view ? "page" : undefined}>
      {n.icon} {n.text}
    </a>
  );

  return (
    <div className="app">
      <nav className="nav" aria-label="Devices">
        {admin ? (
          <>
            {MANAGE.map(link)}
            <div className="navsection">Endpoint security</div>
            {SECURITY.map(link)}
            <div className="navsection">More</div>
            {MORE.map(link)}
          </>
        ) : (
          MORE.filter((i) => i.view !== "audit").map(link)
        )}
        <span className="grow" />
        <div className="whoami small">
          <span className="rname">{me.name}</span>
          <span className="muted">{admin ? "Device admin" : me.email}</span>
        </div>
      </nav>
      <main className="view">
        {view === "overview" ? <Overview app={app} />
          : view === "devices" ? (route.id ? <DeviceView key={route.id} app={app} id={route.id} tab={route.tab} /> : <DeviceList app={app} />)
          : view === "compliance" ? <Policies app={app} />
          : view === "profiles" ? <Profiles app={app} />
          : view === "apps" ? <Apps app={app} />
          : view === "apple" ? <AppleSetup app={app} />
          : view === "android" ? <AndroidSetup app={app} />
          : view === "windows" ? <WindowsSetup app={app} />
          : view === "alerts" ? (route.id ? <AlertView key={route.id} app={app} id={route.id} /> : <AlertList app={app} />)
          : view === "vulnerabilities" ? <Vulnerabilities app={app} id={route.id} />
          : view === "hunting" ? <Hunting app={app} id={route.id} />
          : view === "indicators" ? <Indicators app={app} />
          : view === "enroll" ? <Enroll app={app} organization />
          : view === "audit" ? <Audit app={app} />
          : view === "about" ? <About />
          : <DeviceList app={app} mine />}
      </main>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}
