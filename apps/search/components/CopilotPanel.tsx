"use client";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Check, FileText, MessageSquareText, SendHorizontal, Sparkles, TriangleAlert, X } from "lucide-react";
import type { Source } from "@/lib/ask";
import type { AppOutcome } from "@/lib/fanout";
import type { Proposal } from "@/lib/copilot/copilot";
import { formatDate, post, withCitations } from "./SearchApp";

type CardState = { status: "pending" | "running" | "done" | "cancelled" | "error"; message?: string; url?: string; open?: string; edits?: Record<string, string>; editing?: boolean };
type Entry =
  | { role: "user"; content: string }
  | { role: "assistant"; kind: "answer"; content: string; sources: Source[]; missing?: AppOutcome[] }
  | { role: "assistant"; kind: "summary"; content: string; item: { title: string; url: string } }
  | { role: "assistant"; kind: "actions"; content: string; proposals: Proposal[]; problems: string[]; ignored: number }
  | { role: "assistant"; kind: "error"; content: string };

type Reply =
  | { mode: "answer"; answer: string; sources: Source[]; apps: AppOutcome[] }
  | { mode: "summary"; answer: string; item: { title: string; url: string } }
  | { mode: "actions"; reply: string; proposals: Proposal[]; problems: string[]; ignored: number };

const SUMMARY_APPS = new Set(["mail", "chat", "notes"]);

/** Suite pages that may tell the panel what's open: the suite's own sites (any localhost port in development). */
function trustedParent(origin: string, domain: string): boolean {
  if (!domain) return /^http:\/\/localhost(:\d+)?$/.test(origin);
  if (origin === `https://${domain}`) return true;
  return origin.startsWith("https://") && origin.endsWith(`.${domain}`) && !origin.slice(8, -domain.length - 1).includes("/");
}

/** The fields a person can change on a card, with how to show them. */
const FIELDS: Record<string, [string, string, "text" | "area" | "date" | "datetime" | "list"][]> = {
  "todo.task": [["title", "Title", "text"], ["due", "Due", "date"], ["list", "List", "text"]],
  "calendar.event": [["title", "Title", "text"], ["start", "Start", "datetime"], ["end", "End", "datetime"], ["attendees", "Attendees", "list"], ["location", "Where", "text"], ["description", "Notes", "area"]],
  "mail.draft": [["to", "To", "list"], ["cc", "Cc", "list"], ["subject", "Subject", "text"], ["body", "Body", "area"]],
  "chat.message": [["to", "Post to", "text"], ["text", "Message", "area"]],
  "planner.card": [["title", "Title", "text"], ["board", "Board", "text"]],
};

function fieldValue(p: Proposal, key: string): string {
  const v = (p.action as unknown as Record<string, unknown>)[key];
  return Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : "";
}

export function CopilotPanel({ initialApp, appNames, initialContext, aiOn, name, domain }: {
  initialApp: string; appNames: Record<string, string>; initialContext: string; aiOn: boolean; name: string; domain: string;
}) {
  const [app, setApp] = useState(initialApp);
  const [context, setContext] = useState(initialContext);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [off, setOff] = useState(aiOn ? "" : "No AI model is configured for the suite.");
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const tz = useRef("UTC");

  useEffect(() => {
    try {
      tz.current = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch { /* keep UTC */ }
    // The suite header tells the panel when the person opens another item.
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || !trustedParent(e.origin, domain)) return;
      const d = e.data as { type?: unknown; app?: unknown; context?: unknown };
      if (d?.type !== "synergy-copilot-context") return;
      if (typeof d.app === "string" && /^[a-z]{0,20}$/.test(d.app)) setApp(d.app);
      if (typeof d.context === "string") setContext(d.context.slice(0, 500));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [domain]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [entries, busy]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const history = entries
      .filter((e) => e.role === "user" || e.kind !== "error")
      .slice(-6)
      .map((e) => ({ role: e.role, content: e.content }));
    setEntries((t) => [...t, { role: "user", content: q }]);
    setMessage("");
    setBusy(true);
    try {
      const r = await post<Reply>("/api/copilot", { message: q, history, app, context, tz: tz.current });
      if (r.mode === "answer") setEntries((t) => [...t, { role: "assistant", kind: "answer", content: r.answer, sources: r.sources, missing: r.apps }]);
      else if (r.mode === "summary") setEntries((t) => [...t, { role: "assistant", kind: "summary", content: r.answer, item: r.item }]);
      else {
        setCards((c) => ({ ...c, ...Object.fromEntries(r.proposals.map((p) => [p.id, { status: "pending" } as CardState])) }));
        setEntries((t) => [...t, { role: "assistant", kind: "actions", content: r.reply, proposals: r.proposals, problems: r.problems, ignored: r.ignored }]);
      }
    } catch (err) {
      if ((err as { status?: number }).status === 503) setOff((err as Error).message);
      setEntries((t) => [...t, { role: "assistant", kind: "error", content: (err as Error).message || "Something went wrong" }]);
    } finally {
      setBusy(false);
      boxRef.current?.focus();
    }
  };

  const setCard = (id: string, s: Partial<CardState>) => setCards((c) => ({ ...c, [id]: { ...c[id], ...s } as CardState }));

  const confirm = async (p: Proposal) => {
    const card = cards[p.id];
    setCard(p.id, { status: "running", message: undefined });
    // A window opened before the request keeps the click's permission to open it (Mail drafts).
    const popup = p.kind === "mail.draft" ? window.open("about:blank", "_blank") : null;
    try {
      const done = await post<{ message: string; url?: string; open?: string }>("/api/copilot/confirm", { id: p.id, confirm: true, ...(card?.edits ? { edits: card.edits } : {}) });
      if (done.open) {
        if (popup) {
          popup.opener = null;
          popup.location.href = done.open;
        } else {
          window.open(done.open, "_blank", "noopener");
        }
      }
      setCard(p.id, { status: "done", message: done.message, url: done.url, open: done.open, editing: false });
    } catch (err) {
      popup?.close();
      setCard(p.id, { status: "error", message: (err as Error).message });
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(message);
    }
  };

  const here = app ? appNames[app] ?? app : "";
  const canSummarize = SUMMARY_APPS.has(app) && Boolean(context);

  if (off) {
    return (
      <main className="copilot">
        <div className="notice warn" role="note">
          <MessageSquareText size={18} aria-hidden="true" />
          <div>
            <p><strong>Copilot is off.</strong> {off}</p>
            <p>An administrator can turn it on by setting <code>AI_MODEL</code> (and <code>AI_API_KEY</code> or <code>AI_BASE_URL</code>), or <code>SEARCH_AI_*</code> to give Copilot its own model.</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="copilot">
      {here && <p className="muted small cp-where">In {here}</p>}
      {entries.length === 0 && (
        <div className="empty cp-empty">
          <Sparkles size={26} aria-hidden="true" />
          <p>Hi {name}. Ask about your mail, files, chats, meetings and notes, or ask me to do something.</p>
          <div className="chips">
            {canSummarize && <button type="button" className="chip" onClick={() => void send("Summarize this")}><FileText size={13} aria-hidden="true" /> Summarize this</button>}
            <button type="button" className="chip" onClick={() => setMessage("Create a task to ")}>Create a task…</button>
            <button type="button" className="chip" onClick={() => setMessage("Schedule a meeting with ")}>Schedule a meeting…</button>
            <button type="button" className="chip" onClick={() => setMessage("Draft an email to ")}>Draft an email…</button>
          </div>
          <p className="small">Copilot only proposes changes. Nothing happens in your apps until you press Confirm.</p>
        </div>
      )}
      <ol className="thread" aria-live="polite">
        {entries.map((e, i) => (
          <li key={i} className={`turn ${e.role} ${e.role === "assistant" && e.kind === "error" ? "err" : ""}`}>
            <span className="sr-only">{e.role === "user" ? "You:" : "Copilot:"}</span>
            {e.role === "user" || e.kind === "error" ? (
              <div className="bubble">{e.content}</div>
            ) : e.kind === "answer" ? (
              <>
                <div className="bubble">{withCitations(e.content, e.sources, "_blank")}</div>
                {e.sources.length > 0 && (
                  <ol className="sources" aria-label="Sources">
                    {e.sources.map((s) => (
                      <li key={s.n} value={s.n}><a href={s.url} target="_blank" rel="noopener">{s.title}</a> <span className="muted small">· {s.appName}{s.date ? ` · ${formatDate(s.date)}` : ""}</span></li>
                    ))}
                  </ol>
                )}
              </>
            ) : e.kind === "summary" ? (
              <>
                <div className="bubble">{e.content}</div>
                <p className="quiet small">Summary of <a href={e.item.url} target="_blank" rel="noopener">{e.item.title}</a>. Check important details in the original.</p>
              </>
            ) : (
              <>
                <div className="bubble">{e.content}</div>
                {e.proposals.map((p) => (
                  <ProposalCard key={p.id} p={p} state={cards[p.id] ?? { status: "pending" }}
                    onConfirm={() => void confirm(p)}
                    onCancel={() => setCard(p.id, { status: "cancelled" })}
                    onEdit={(editing) => setCard(p.id, { editing, edits: editing ? (cards[p.id]?.edits ?? Object.fromEntries(FIELDS[p.kind].map(([k]) => [k, fieldValue(p, k)]))) : cards[p.id]?.edits })}
                    onField={(k, v) => setCard(p.id, { edits: { ...(cards[p.id]?.edits ?? {}), [k]: v } })}
                  />
                ))}
                {e.problems.map((m, j) => <p key={j} className="notice warn small" role="note"><TriangleAlert size={14} aria-hidden="true" /> {m}</p>)}
                {e.ignored > 0 && <p className="quiet small">Left out {e.ignored} suggestion{e.ignored === 1 ? "" : "s"} you didn&apos;t ask for.</p>}
              </>
            )}
          </li>
        ))}
        {busy && <li className="turn assistant"><div className="bubble muted">Working on it…</div></li>}
      </ol>
      <div ref={endRef} />
      <form className="askform" onSubmit={(e: FormEvent) => { e.preventDefault(); void send(message); }}>
        <label htmlFor="cp-message" className="sr-only">Message Copilot</label>
        <textarea id="cp-message" ref={boxRef} rows={2} value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} onKeyDown={onKey}
          placeholder={canSummarize ? "Ask, or say \"summarize this\"" : "Ask a question or ask me to do something"} />
        <button className="btn primary" type="submit" disabled={busy || !message.trim()} aria-label="Send"><SendHorizontal size={16} aria-hidden="true" /></button>
      </form>
      {entries.length > 0 && (
        <div className="cp-foot">
          {canSummarize && <button type="button" className="linkbtn small" onClick={() => void send("Summarize this")} disabled={busy}>Summarize this</button>}
          <button type="button" className="linkbtn small" onClick={() => { setEntries([]); setCards({}); }} disabled={busy}>New conversation</button>
        </div>
      )}
    </main>
  );
}

function ProposalCard({ p, state, onConfirm, onCancel, onEdit, onField }: {
  p: Proposal; state: CardState; onConfirm: () => void; onCancel: () => void; onEdit: (editing: boolean) => void; onField: (k: string, v: string) => void;
}) {
  const live = state.status === "pending" || state.status === "error";
  return (
    <section className={`proposal ${state.status}`} aria-label={p.label}>
      <h3>{p.label}</h3>
      {state.editing && live ? (
        <div className="fields">
          {FIELDS[p.kind].map(([k, label, type]) => (
            <label key={k}>
              <span>{label}</span>
              {type === "area" ? (
                <textarea rows={4} value={state.edits?.[k] ?? ""} onChange={(e) => onField(k, e.target.value)} />
              ) : (
                <input type={type === "date" ? "date" : type === "datetime" ? "datetime-local" : "text"} value={state.edits?.[k] ?? ""} onChange={(e) => onField(k, e.target.value)} />
              )}
            </label>
          ))}
        </div>
      ) : state.edits ? (
        <dl>
          {FIELDS[p.kind].filter(([k]) => state.edits?.[k]).map(([k, label]) => (
            <div key={k}><dt>{label}</dt><dd>{state.edits?.[k]}</dd></div>
          ))}
        </dl>
      ) : (
        <dl>
          {p.summary.map(([k, v], i) => (
            <div key={i}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      )}
      {p.warnings.map((w, i) => <p key={i} className="warnline small"><TriangleAlert size={13} aria-hidden="true" /> {w}</p>)}
      {state.status === "error" && <p className="errline small" role="alert">{state.message}</p>}
      {state.status === "done" && (
        <p className="okline small" role="status">
          <Check size={14} aria-hidden="true" /> {state.message}{" "}
          {state.url && <a href={state.url} target="_blank" rel="noopener">Open</a>}
          {state.open && <a href={state.open} target="_blank" rel="noopener">Open the draft</a>}
        </p>
      )}
      {state.status === "cancelled" && <p className="quiet small">Cancelled. Nothing was changed.</p>}
      {live && (
        <div className="cp-actions">
          <button type="button" className="btn primary" onClick={onConfirm}><Check size={15} aria-hidden="true" /> Confirm</button>
          <button type="button" className="btn" onClick={() => onEdit(!state.editing)}>{state.editing ? "Done editing" : "Edit"}</button>
          <button type="button" className="btn" onClick={onCancel}><X size={15} aria-hidden="true" /> Cancel</button>
        </div>
      )}
      {state.status === "running" && <p className="quiet small">Working…</p>}
      {live && <p className="quiet small">{p.kind === "mail.draft" ? "Confirm opens the draft in Mail. It's sent only when you press Send there." : "Nothing happens until you press Confirm."}</p>}
    </section>
  );
}
