"use client";
import {
  BookOpen, CheckCircle2, Circle, Clock, ExternalLink, Inbox, Layers, MailCheck, MailX, MessageSquareText, Plus, Search,
  UserRound, UserX, Archive,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Article, Canned, Ticket } from "@/lib/types";
import { CannedPane, CannedList } from "./CannedPane";
import { api } from "./client";
import { KbList, KbPane } from "./KbPane";
import { NewTicketDialog } from "./NewTicketDialog";
import { TicketList } from "./TicketList";
import { TicketPane } from "./TicketPane";

export type Me = { email: string; name: string };
export type MailState = { inbound: boolean; outbound: boolean };
type View = "open" | "pending" | "solved" | "closed" | "all" | "mine" | "unassigned";
type Section = { kind: "tickets"; view: View } | { kind: "canned" } | { kind: "kb" };
type Counts = Record<View, number>;

const VIEWS: { view: View; label: string; icon: React.ReactNode }[] = [
  { view: "open", label: "Open", icon: <Inbox size={18} /> },
  { view: "pending", label: "Pending", icon: <Clock size={18} /> },
  { view: "solved", label: "Solved", icon: <CheckCircle2 size={18} /> },
  { view: "closed", label: "Closed", icon: <Archive size={18} /> },
  { view: "all", label: "All tickets", icon: <Layers size={18} /> },
];
const QUEUES: { view: View; label: string; icon: React.ReactNode }[] = [
  { view: "mine", label: "Assigned to me", icon: <UserRound size={18} /> },
  { view: "unassigned", label: "Unassigned", icon: <UserX size={18} /> },
];

export function DeskApp({ me }: { me: Me }) {
  const [section, setSection] = useState<Section>({ kind: "tickets", view: "open" });
  const [query, setQuery] = useState("");
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [canned, setCanned] = useState<Canned[]>([]);
  const [articles, setArticles] = useState<Article[] | null>(null);
  const [pick, setPick] = useState<number | "new" | null>(null); // the canned reply or article open on the right
  const [mail, setMail] = useState<MailState>({ inbound: false, outbound: false });
  const [dialog, setDialog] = useState<React.ReactNode>(null);
  const [toast, setToast] = useState("");

  const say = useCallback((t: string) => {
    setToast(t);
    window.setTimeout(() => setToast((x) => (x === t ? "" : x)), 3500);
  }, []);

  const view = section.kind === "tickets" ? section.view : null;

  const loadTickets = useCallback(async () => {
    if (!view) return;
    const p = new URLSearchParams({ view });
    if (query) p.set("q", query);
    const r = await api<{ tickets: Ticket[]; counts: Counts }>(`/api/tickets?${p}`);
    setTickets(r.tickets);
    setCounts(r.counts);
  }, [view, query]);

  const loadCanned = useCallback(async () => setCanned(await api<Canned[]>("/api/canned")), []);
  const loadArticles = useCallback(async () => setArticles(await api<Article[]>("/api/kb")), []);

  useEffect(() => {
    if (!view) return;
    const t = window.setTimeout(() => void loadTickets().catch((e) => say(e.message)), query ? 200 : 0);
    return () => window.clearTimeout(t);
  }, [loadTickets, view, query, say]);

  // New mail arrives on its own, so the queue refreshes itself while the tab is visible.
  useEffect(() => {
    if (!view) return;
    const t = window.setInterval(() => document.visibilityState === "visible" && void loadTickets().catch(() => {}), 30000);
    return () => window.clearInterval(t);
  }, [loadTickets, view]);

  useEffect(() => {
    void api<{ mail: MailState }>("/api/me").then((r) => setMail(r.mail)).catch(() => {});
    void loadCanned().catch(() => {});
    // ?ticket=<id> opens one ticket, ?article=<id> one knowledge-base article (links from other apps).
    const sp = new URL(location.href).searchParams;
    const id = Number(sp.get("ticket"));
    const article = Number(sp.get("article"));
    if (id > 0) {
      setSection({ kind: "tickets", view: "all" });
      setSelected(id);
    } else if (article > 0) {
      setSection({ kind: "kb" });
      setPick(article);
    }
  }, [loadCanned]);

  useEffect(() => {
    if (section.kind === "kb") void loadArticles().catch((e) => say(e.message));
    if (section.kind === "canned") void loadCanned().catch((e) => say(e.message));
  }, [section.kind, loadArticles, loadCanned, say]);

  const go = (s: Section) => {
    setSection(s);
    setPick(null);
    if (s.kind !== "tickets") setSelected(null);
  };

  const newTicket = () =>
    setDialog(
      <NewTicketDialog
        onClose={() => setDialog(null)}
        onCreated={async (t) => {
          setDialog(null);
          setSection({ kind: "tickets", view: "open" });
          setQuery("");
          setSelected(t.id);
          await loadTickets().catch(() => {});
          say(`Ticket ${t.number} created`);
        }}
      />,
    );

  const navItem = (v: { view: View; label: string; icon: React.ReactNode }) => (
    <button key={v.view} className={`navitem${view === v.view ? " active" : ""}`} onClick={() => go({ kind: "tickets", view: v.view })}>
      {v.icon}
      <span className="grow">{v.label}</span>
      {counts && counts[v.view] > 0 && v.view !== "all" && <span className="count">{counts[v.view]}</span>}
    </button>
  );

  const reading = section.kind === "tickets" ? selected !== null : pick !== null;

  return (
    <div className={`desk${reading ? " withdetail" : ""}`}>
      <nav className="nav">
        <button className="btn primary newbtn" onClick={newTicket}>
          <Plus size={18} /> New ticket
        </button>
        <div className="navsection">Tickets</div>
        {VIEWS.map(navItem)}
        <div className="navsection">Queues</div>
        {QUEUES.map(navItem)}
        <div className="navsection">Library</div>
        <button className={`navitem${section.kind === "canned" ? " active" : ""}`} onClick={() => go({ kind: "canned" })}>
          <MessageSquareText size={18} /> <span className="grow">Canned replies</span>
        </button>
        <button className={`navitem${section.kind === "kb" ? " active" : ""}`} onClick={() => go({ kind: "kb" })}>
          <BookOpen size={18} /> <span className="grow">Knowledge base</span>
        </button>
        <a className="navitem" href="/kb" target="_blank" rel="noopener">
          <ExternalLink size={18} /> <span className="grow">Public help center</span>
        </a>
        <div className="grow" />
        <div className="mailstate small">
          <span className={mail.inbound ? "ok" : "muted"} title="Unread mail in the support mailbox becomes tickets">
            {mail.inbound ? <MailCheck size={15} /> : <MailX size={15} />} Email intake {mail.inbound ? "on" : "off"}
          </span>
          <span className={mail.outbound ? "ok" : "muted"} title="Replies are emailed to the requester">
            {mail.outbound ? <MailCheck size={15} /> : <MailX size={15} />} Email replies {mail.outbound ? "on" : "off"}
          </span>
        </div>
      </nav>

      {section.kind === "tickets" && (
        <>
          <section className="listpane">
            <div className="listhead">
              <div className="titlerow">
                <h1 className="grow">{[...VIEWS, ...QUEUES].find((v) => v.view === section.view)?.label}</h1>
                <span className="muted small">{tickets ? `${tickets.length}${tickets.length === 300 ? "+" : ""}` : ""}</span>
              </div>
              <label className="search">
                <Search size={16} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search tickets"
                  aria-label="Search tickets"
                />
              </label>
            </div>
            <TicketList tickets={tickets} selected={selected} onOpen={setSelected} query={query} view={section.view} />
          </section>
          <section className="detail">
            {selected !== null ? (
              <TicketPane
                key={selected}
                id={selected}
                me={me}
                mail={mail}
                canned={canned}
                onBack={() => setSelected(null)}
                onChanged={() => void loadTickets().catch(() => {})}
                say={say}
              />
            ) : (
              <div className="empty">
                <Circle size={40} strokeWidth={1.2} />
                <p>Select a ticket to read the conversation and reply.</p>
              </div>
            )}
          </section>
        </>
      )}

      {section.kind === "canned" && (
        <>
          <CannedList canned={canned} pick={pick} onPick={setPick} />
          <section className="detail">
            <CannedPane
              key={String(pick)}
              item={pick === "new" ? null : canned.find((c) => c.id === pick) ?? null}
              open={pick !== null}
              onBack={() => setPick(null)}
              onSaved={async (c) => {
                await loadCanned();
                setPick(c ? c.id : null);
                say(c ? "Reply saved" : "Reply deleted");
              }}
            />
          </section>
        </>
      )}

      {section.kind === "kb" && (
        <>
          <KbList articles={articles} pick={pick} onPick={setPick} />
          <section className="detail">
            <KbPane
              key={String(pick)}
              item={pick === "new" ? null : articles?.find((a) => a.id === pick) ?? null}
              open={pick !== null}
              onBack={() => setPick(null)}
              onSaved={async (a, verb) => {
                await loadArticles();
                setPick(a ? a.id : null);
                say(verb);
              }}
            />
          </section>
        </>
      )}

      {dialog}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
