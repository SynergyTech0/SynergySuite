"use client";
import { BookOpen, CalendarClock, CheckCheck, FileSignature, FileText, LayoutDashboard, Library, Plus, Search, User } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { STATUS_LABELS, api, money, relDays, shortDate } from "./client";
import { ContractView } from "./ContractView";
import { Dashboard } from "./Dashboard";
import { LibraryView } from "./Library";
import { NewContract } from "./NewContract";

export type Me = { email: string; name: string };
export type AppInfo = {
  email: string; legal: boolean; library: boolean; ai: boolean; signing: boolean; signApp: string; types: string[]; statuses: string[];
};
export type ContractSummary = {
  id: string; number: string; title: string; type: string; status: string; counterparty: string; owner: string;
  value_cents: number | null; currency: string; start_day: string | null; end_day: string | null; auto_renew: boolean;
  days_left: number | null; notice_day: string | null; notice_days: number;
};

type ListView = "all" | "mine" | "approvals" | "expiring" | "signing";
type View =
  | { kind: "dashboard" }
  | { kind: "list"; list: ListView }
  | { kind: "contract"; id: string }
  | { kind: "library"; tab: "templates" | "clauses"; item?: string };

const LISTS: Record<ListView, string> = {
  all: "All contracts", mine: "My contracts", approvals: "Waiting for my approval", expiring: "Ending in 90 days", signing: "Out for signature",
};

function fromUrl(): View {
  const s = new URLSearchParams(window.location.search);
  const c = s.get("contract");
  if (c) return { kind: "contract", id: c };
  const lib = s.get("library");
  if (lib === "templates" || lib === "clauses") return { kind: "library", tab: lib, item: s.get("template") ?? s.get("clause") ?? undefined };
  const l = s.get("list") as ListView | null;
  if (l && l in LISTS) return { kind: "list", list: l };
  return { kind: "dashboard" };
}

function toUrl(v: View): string {
  if (v.kind === "contract") return `?contract=${v.id}`;
  if (v.kind === "library") return `?library=${v.tab}`;
  if (v.kind === "list") return `?list=${v.list}`;
  return "/";
}

export function ContractsApp({ me }: { me: Me }) {
  const [view, setView] = useState<View>({ kind: "dashboard" });
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [waiting, setWaiting] = useState(0);
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

  useEffect(() => {
    api<ContractSummary[]>("/api/contracts?view=approvals").then((r) => setWaiting(r.length)).catch(() => {});
  }, [tick]);

  const go = (v: View) => {
    setView(v);
    window.history.pushState(null, "", toUrl(v));
  };
  const on = (match: boolean) => (match ? " active" : "");

  return (
    <div className="app">
      <nav className="nav" aria-label="Contracts">
        <button className="btn primary newbtn" onClick={() => setCreating(true)}>
          <Plus size={16} /> New contract
        </button>
        <button className={`navitem${on(view.kind === "dashboard")}`} onClick={() => go({ kind: "dashboard" })}>
          <LayoutDashboard size={17} /> Overview
        </button>
        {(Object.keys(LISTS) as ListView[]).map((l) => (
          <button key={l} className={`navitem${on(view.kind === "list" && view.list === l)}`} onClick={() => go({ kind: "list", list: l })}>
            {l === "all" ? <FileText size={17} /> : l === "mine" ? <User size={17} /> : l === "approvals" ? <CheckCheck size={17} /> : l === "expiring" ? <CalendarClock size={17} /> : <FileSignature size={17} />}
            <span className="grow">{LISTS[l]}</span>
            {l === "approvals" && waiting > 0 && <span className="count">{waiting}</span>}
          </button>
        ))}
        <div className="navsection">Library</div>
        <button className={`navitem${on(view.kind === "library" && view.tab === "templates")}`} onClick={() => go({ kind: "library", tab: "templates" })}>
          <BookOpen size={17} /> Templates
        </button>
        <button className={`navitem${on(view.kind === "library" && view.tab === "clauses")}`} onClick={() => go({ kind: "library", tab: "clauses" })}>
          <Library size={17} /> Clauses
        </button>
      </nav>
      <main className="main">
        {view.kind === "dashboard" && <Dashboard key={tick} me={me} onOpen={(id) => go({ kind: "contract", id })} onNew={() => setCreating(true)} />}
        {view.kind === "list" && <ContractList key={`${view.list}-${tick}`} list={view.list} info={info} onOpen={(id) => go({ kind: "contract", id })} />}
        {view.kind === "contract" && info && (
          <ContractView
            key={view.id}
            id={view.id}
            me={me}
            info={info}
            onChange={refresh}
            onDeleted={() => {
              refresh();
              go({ kind: "list", list: "all" });
            }}
          />
        )}
        {view.kind === "library" && info && <LibraryView key={view.tab} tab={view.tab} focus={view.item} info={info} />}
      </main>
      {creating && info && (
        <NewContract
          info={info}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            refresh();
            go({ kind: "contract", id });
          }}
        />
      )}
    </div>
  );
}

function ContractList({ list, info, onOpen }: { list: ListView; info: AppInfo | null; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<ContractSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams({ view: list });
      if (q) p.set("q", q);
      if (status) p.set("status", status);
      if (type) p.set("type", type);
      api<ContractSummary[]>(`/api/contracts?${p}`).then(setRows).catch((e) => setError((e as Error).message));
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [list, q, status, type]);

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>{LISTS[list]}</h1>
          <p className="sub muted">{info?.legal ? "As legal, you see every contract." : "Contracts you own, are shared on, or approve."}</p>
        </div>
      </div>
      <div className="body">
        <div className="toolbar">
          <label className="searchbox">
            <Search size={15} />
            <input placeholder="Search title, counterparty or number" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <select className="cellin" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Any status</option>
            {(info?.statuses ?? []).map((s) => <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>)}
          </select>
          <select className="cellin" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
            <option value="">Any type</option>
            {(info?.types ?? []).map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        {error && <p className="error">{error}</p>}
        {!rows ? (
          <p className="muted">Loading…</p>
        ) : !rows.length ? (
          <div className="empty">Nothing here.</div>
        ) : (
          <ContractTable rows={rows} onOpen={onOpen} />
        )}
      </div>
    </>
  );
}

export function ContractTable({ rows, onOpen }: { rows: ContractSummary[]; onOpen: (id: string) => void }) {
  return (
    <div className="tablewrap">
      <table className="grid">
        <thead>
          <tr>
            <th>Contract</th><th>Counterparty</th><th>Type</th><th>Status</th><th>Ends</th><th className="num">Value</th><th>Owner</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="click" onClick={() => onOpen(c.id)}>
              <td><span className="muted small">{c.number}</span> {c.title}</td>
              <td>{c.counterparty}</td>
              <td>{c.type}</td>
              <td><span className={`pill ${c.status}`}>{STATUS_LABELS[c.status] ?? c.status}</span></td>
              <td>
                {c.end_day ? shortDate(c.end_day) : <span className="muted">No end date</span>}
                {c.status === "active" && c.days_left !== null && c.days_left <= 90 && <span className="muted small"> ({relDays(c.days_left)})</span>}
                {c.auto_renew && <span className="pill small" title="Renews by itself">auto</span>}
              </td>
              <td className="num">{c.value_cents !== null ? money(c.value_cents, c.currency) : ""}</td>
              <td className="muted">{c.owner.split("@")[0]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
