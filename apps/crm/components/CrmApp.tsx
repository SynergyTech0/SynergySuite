"use client";
// The CRM: navigation on the left, the chosen view on the right. Where you are lives in the
// address (#/leads/<id>) so reloading and the back button work.
import {
  Building2, CalendarCheck, ChevronDown, Columns3, Contact as ContactIcon, Gauge, Plus, Target, UserPlus, Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Account, Contact, Ctx, Lead, Member, Opportunity } from "@/lib/types";
import { label } from "@/lib/types";
import { api, useRoute, type View } from "./client";
import { Dashboard } from "./Dashboard";
import { AccountEditor, ContactEditor, LeadEditor, OpportunityEditor } from "./Editors";
import { MyDay } from "./MyDay";
import { Pipeline } from "./Pipeline";
import { RecordsView } from "./Records";
import type { AppCtx } from "./shared";
import { Team } from "./Team";

const NAV: { view: View; text: string; icon: React.ReactNode }[] = [
  { view: "dashboard", text: "Dashboard", icon: <Gauge size={18} /> },
  { view: "myday", text: "My Day", icon: <CalendarCheck size={18} /> },
  { view: "leads", text: "Leads", icon: <UserPlus size={18} /> },
  { view: "accounts", text: "Accounts", icon: <Building2 size={18} /> },
  { view: "contacts", text: "Contacts", icon: <ContactIcon size={18} /> },
  { view: "opportunities", text: "Opportunities", icon: <Target size={18} /> },
  { view: "pipeline", text: "Pipeline", icon: <Columns3 size={18} /> },
];

type NewKind = "leads" | "accounts" | "contacts" | "opportunities";

export function CrmApp({ me: initialMe }: { me: Ctx }) {
  const [route, go] = useRoute();
  const [me, setMe] = useState(initialMe);
  const [members, setMembers] = useState<Member[]>([]);
  const [ai, setAi] = useState(false);
  const [repRead, setRepRead] = useState<"own" | "all">("own");
  const [version, setVersion] = useState(0);
  const [myDayCount, setMyDayCount] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [menu, setMenu] = useState(false);
  const [creating, setCreating] = useState<NewKind | null>(null);

  const say = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((t) => (t === text ? "" : t)), 5000);
  }, []);

  useEffect(() => {
    void api<{ me: Ctx; members: Member[]; ai: boolean; repRead: "own" | "all" }>("/api/me")
      .then((r) => {
        setMe(r.me);
        setMembers(r.members);
        setAi(r.ai);
        setRepRead(r.repRead);
      })
      .catch((e) => say(e.message));
  }, [say]);

  useEffect(() => {
    void api<unknown[]>("/api/activities?mine=1").then((r) => setMyDayCount(r.length)).catch(() => {});
  }, [version]);

  const app: AppCtx = useMemo(() => ({
    me, members, ai, repRead, setRepRead, version, say,
    go: (view: View, id?: string | null) => go({ view, id: id ?? null }),
    changed: () => setVersion((v) => v + 1),
  }), [me, members, ai, repRead, version, say, go]);

  const Editor = creating
    ? ({ leads: LeadEditor, accounts: AccountEditor, contacts: ContactEditor, opportunities: OpportunityEditor }[creating] as
        (p: { app: AppCtx; onClose: () => void; onSaved: (r: Lead | Account | Contact | Opportunity) => void }) => React.ReactNode)
    : null;

  return (
    <div className="crm">
      <nav className="nav" aria-label="CRM">
        <div className="newwrap">
          <button className="btn primary newbtn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <Plus size={16} /> New <ChevronDown size={14} />
          </button>
          {menu ? (
            <div className="menu newmenu" role="menu" onMouseLeave={() => setMenu(false)}>
              {(["leads", "accounts", "contacts", "opportunities"] as NewKind[]).map((k) => (
                <button key={k} role="menuitem" onClick={() => { setMenu(false); setCreating(k); }}>
                  {NAV.find((n) => n.view === k)!.icon} {label(k === "leads" ? "lead" : k === "accounts" ? "account" : k === "contacts" ? "contact" : "opportunity")}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {NAV.map((n) => (
          <a
            key={n.view}
            href={`#/${n.view}`}
            className={`navitem${route.view === n.view ? " active" : ""}`}
            aria-current={route.view === n.view ? "page" : undefined}
          >
            {n.icon} {n.text}
            {n.view === "myday" && myDayCount ? <span className="count">{myDayCount}</span> : null}
          </a>
        ))}
        <div className="navsection">Settings</div>
        <a href="#/team" className={`navitem${route.view === "team" ? " active" : ""}`} aria-current={route.view === "team" ? "page" : undefined}>
          <Users size={18} /> Team
        </a>
        <span className="grow" />
        <div className="whoami small">
          <span className="rname">{me.name}</span>
          <span className="muted">{label(me.role)}{ai ? " · AI scoring on" : ""}</span>
        </div>
      </nav>
      <main className="view">
        {route.view === "dashboard" ? <Dashboard app={app} />
          : route.view === "myday" ? <MyDay app={app} />
          : route.view === "pipeline" ? <Pipeline app={app} />
          : route.view === "team" ? <Team app={app} onMembers={(m) => { setMembers(m); setMe((cur) => ({ ...cur, role: m.find((x) => x.email === cur.email)?.role ?? cur.role })); }} />
          : <RecordsView app={app} kind={route.view} id={route.id} />}
      </main>
      {Editor ? (
        <Editor
          app={app}
          onClose={() => setCreating(null)}
          onSaved={(r) => {
            const kind = creating!;
            setCreating(null);
            app.changed();
            go({ view: kind, id: r.id });
          }}
        />
      ) : null}
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}
