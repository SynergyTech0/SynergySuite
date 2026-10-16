"use client";
// Campaigns: navigation on the left, the chosen view on the right. Where you are lives in the
// address (#/campaigns/<id>) so reloading and the back button work.
import { Gauge, LayoutTemplate, Send, Settings as SettingsIcon, Users, Workflow } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Ctx, Member, Settings } from "@/lib/types";
import { label } from "@/lib/types";
import { AudiencesView } from "./Audiences";
import { AutomationsView } from "./Automations";
import { CampaignsView } from "./Campaigns";
import { api, useRoute, type AppCtx, type View } from "./client";
import { Dashboard } from "./Dashboard";
import { SettingsView } from "./SettingsView";
import { TemplatesView } from "./Templates";

const NAV: { view: View; text: string; icon: React.ReactNode }[] = [
  { view: "dashboard", text: "Dashboard", icon: <Gauge size={18} /> },
  { view: "campaigns", text: "Campaigns", icon: <Send size={18} /> },
  { view: "audiences", text: "Audiences", icon: <Users size={18} /> },
  { view: "templates", text: "Templates", icon: <LayoutTemplate size={18} /> },
  { view: "automations", text: "Automations", icon: <Workflow size={18} /> },
  { view: "settings", text: "Settings", icon: <SettingsIcon size={18} /> },
];

export function CampaignsApp({ me: initialMe }: { me: Ctx }) {
  const [route, go] = useRoute();
  const [me, setMe] = useState(initialMe);
  const [members, setMembers] = useState<Member[]>([]);
  const [ai, setAi] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [toast, setToast] = useState("");
  const [version, setVersion] = useState(0);

  const say = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((t) => (t === text ? "" : t)), 5000);
  }, []);

  useEffect(() => {
    void api<{ me: Ctx; members: Member[]; ai: boolean; settings: Settings }>("/api/me")
      .then((r) => {
        setMe(r.me);
        setMembers(r.members);
        setAi(r.ai);
        setSettings(r.settings);
      })
      .catch((e) => say(e.message));
  }, [say, version]);

  const refreshMe = useCallback(() => setVersion((v) => v + 1), []);
  const ctx: AppCtx | null = settings
    ? { me, canEdit: me.role !== "viewer", members, ai, settings, say, go, refreshMe }
    : null;

  return (
    <div className="app">
      <nav className="nav" aria-label="Campaigns">
        {NAV.map((n) => (
          <a key={n.view} href={`#/${n.view}`} className={`navitem${route.view === n.view ? " active" : ""}`}>
            {n.icon}
            {n.text}
          </a>
        ))}
        <div className="grow" />
        <div className="whoami small">
          <strong>{me.name}</strong>
          <span className="muted">{label(me.role)}</span>
        </div>
      </nav>
      <main className="view">
        {!ctx ? (
          <div className="empty">Loading…</div>
        ) : route.view === "campaigns" ? (
          <CampaignsView ctx={ctx} id={route.id} tab={route.tab} />
        ) : route.view === "audiences" ? (
          <AudiencesView ctx={ctx} id={route.id} tab={route.tab} />
        ) : route.view === "templates" ? (
          <TemplatesView ctx={ctx} id={route.id} />
        ) : route.view === "automations" ? (
          <AutomationsView ctx={ctx} id={route.id} />
        ) : route.view === "settings" ? (
          <SettingsView ctx={ctx} />
        ) : (
          <Dashboard ctx={ctx} />
        )}
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
