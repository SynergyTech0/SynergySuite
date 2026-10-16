"use client";
import { ArrowLeft, Lock, Mail, MessageSquareText, Send, StickyNote } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PRIORITIES, STATUSES, type Canned, type Message, type TicketDetail } from "@/lib/types";
import type { MailState, Me } from "./DeskApp";
import { api, cap, hue, initials, mailUrl, stamp } from "./client";

const SOURCE: Record<string, string> = { manual: "Created by staff", email: "By email", api: "From another app" };

export function TicketPane({ id, me, mail, canned, onBack, onChanged, say }: {
  id: number; me: Me; mail: MailState; canned: Canned[];
  onBack: () => void; onChanged: () => void; say: (t: string) => void;
}) {
  const [t, setT] = useState<TicketDetail | null>(null);
  const [error, setError] = useState("");
  const [assignees, setAssignees] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setT(await api<TicketDetail>(`/api/tickets/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
    void api<string[]>("/api/assignees").then(setAssignees).catch(() => {});
  }, [load]);

  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [t?.messages.length]);

  const patch = async (p: Record<string, string>) => {
    try {
      setT(await api<TicketDetail>(`/api/tickets/${id}`, { method: "PATCH", json: p }));
      onChanged();
    } catch (e) {
      say((e as Error).message);
    }
  };

  if (error) return <div className="empty"><p>{error}</p><button className="btn" onClick={onBack}>Back</button></div>;
  if (!t) return <p className="muted pad">Loading…</p>;

  return (
    <div className="ticket">
      <header className="thead">
        <div className="cardtools">
          <button className="iconbtn back" aria-label="Back to the list" onClick={onBack}><ArrowLeft size={18} /></button>
          <span className="mono muted">{t.number}</span>
          <span className={`st st-${t.status}`}>{t.status}</span>
          <span className="muted small">· {SOURCE[t.source]} · {stamp(t.createdAt)}</span>
        </div>
        <h1 className="tsubj">{t.subject}</h1>
        <div className="requester">
          <span className="avatar" style={{ background: `hsl(${hue(t.requesterEmail)} 60% 92%)`, color: `hsl(${hue(t.requesterEmail)} 55% 32%)` }}>
            {initials(t.requesterName || t.requesterEmail)}
          </span>
          <div className="grow">
            <div className="cname">{t.requesterName || t.requesterEmail}</div>
            {t.requesterName && <div className="csub">{t.requesterEmail}</div>}
          </div>
          <a className="btn small" href={mailUrl(t.requesterEmail)} target="_blank" rel="noopener" title="Write to the requester in Mail">
            <Mail size={15} /> Open in Mail
          </a>
        </div>
        <div className="props">
          <label>
            <span>Status</span>
            <select value={t.status} onChange={(e) => void patch({ status: e.target.value })}>
              {STATUSES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}
            </select>
          </label>
          <label>
            <span>Priority</span>
            <select value={t.priority} onChange={(e) => void patch({ priority: e.target.value })}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{cap(p)}</option>)}
            </select>
          </label>
          <label className="grow">
            <span>Assignee</span>
            <AssigneeField value={t.assignee} options={assignees} onSave={(v) => patch({ assignee: v })} />
          </label>
          {t.assignee !== me.email && (
            <button className="linkbtn assignme" onClick={() => void patch({ assignee: me.email })}>Assign to me</button>
          )}
        </div>
      </header>

      <div className="thread">
        {t.messages.length === 0 && <p className="muted center">No messages yet.</p>}
        {t.messages.map((m) => <Bubble key={m.id} m={m} requester={t.requesterName || t.requesterEmail} />)}
        <div ref={endRef} />
      </div>

      <Composer
        key={t.id}
        ticket={t}
        mail={mail}
        canned={canned}
        onSent={async (internal, emailed, reason) => {
          await load();
          onChanged();
          if (internal) say("Note added");
          else if (emailed) say(`Reply emailed to ${t.requesterEmail}`);
          else say(`Reply saved, not emailed: ${reason || "email sending isn't set up"}`);
        }}
      />
    </div>
  );
}

function AssigneeField({ value, options, onSave }: { value: string; options: string[]; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    const next = v.trim().toLowerCase();
    if (next !== value) void onSave(next);
  };
  return (
    <>
      <input
        list="desk-assignees"
        value={v}
        placeholder="Unassigned"
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      />
      <datalist id="desk-assignees">
        {options.map((o) => <option key={o} value={o} />)}
      </datalist>
    </>
  );
}

function Bubble({ m, requester }: { m: Message; requester: string }) {
  const who = m.direction === "inbound" ? requester : m.author;
  return (
    <article className={`msg ${m.direction}`}>
      <div className="msghead">
        <span className="avatar small" style={{ background: `hsl(${hue(m.author)} 60% 92%)`, color: `hsl(${hue(m.author)} 55% 32%)` }}>
          {initials(who)}
        </span>
        <span className="msgwho">{who}</span>
        {m.direction === "note" && <span className="tag note"><Lock size={11} /> Internal note</span>}
        {m.direction === "outbound" && (m.emailed
          ? <span className="tag">Emailed</span>
          : <span className="tag warn" title="Email sending isn't set up, or the email failed">Not emailed</span>)}
        <span className="grow" />
        <time className="muted small" dateTime={m.createdAt}>{stamp(m.createdAt)}</time>
      </div>
      <div className="msgbody">{m.body}</div>
    </article>
  );
}

function Composer({ ticket, mail, canned, onSent }: {
  ticket: TicketDetail; mail: MailState; canned: Canned[];
  onSent: (internal: boolean, emailed: boolean, reason?: string) => Promise<void>;
}) {
  const [internal, setInternal] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  const insert = (c: Canned) => {
    setMenu(false);
    // Canned replies can greet the requester by name: {{name}} becomes their first name.
    const first = (ticket.requesterName || "").split(/\s+/)[0] || "there";
    const text = c.body.replace(/\{\{\s*name\s*\}\}/gi, first).replace(/\{\{\s*number\s*\}\}/gi, ticket.number);
    setBody((b) => (b.trim() ? `${b.replace(/\s+$/, "")}\n\n${text}` : text));
    area.current?.focus();
  };

  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ emailed: boolean; reason?: string }>(`/api/tickets/${ticket.id}/reply`, { method: "POST", json: { body, internal } });
      setBody("");
      await onSent(internal, r.emailed, r.reason);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`composer${internal ? " isnote" : ""}`}>
      <div className="ctabs" role="tablist">
        <button role="tab" aria-selected={!internal} className={!internal ? "on" : ""} onClick={() => setInternal(false)}>
          <Send size={14} /> Reply
        </button>
        <button role="tab" aria-selected={internal} className={internal ? "on" : ""} onClick={() => setInternal(true)}>
          <StickyNote size={14} /> Internal note
        </button>
        <span className="grow" />
        <div className="menuwrap">
          <button className="btn ghost small" onClick={() => setMenu((x) => !x)} aria-haspopup="menu" aria-expanded={menu}>
            <MessageSquareText size={15} /> Canned reply
          </button>
          {menu && (
            <div className="menu right up" role="menu">
              {canned.length ? canned.map((c) => (
                <button key={c.id} role="menuitem" onClick={() => insert(c)}>
                  <span className="fname">{c.title}</span>
                </button>
              )) : <p className="muted small pad">No canned replies yet. Add some under Library.</p>}
            </div>
          )}
        </div>
      </div>
      <textarea
        ref={area}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send();
        }}
        placeholder={internal ? "Write a note for staff. The requester never sees it." : `Reply to ${ticket.requesterName || ticket.requesterEmail}…`}
        rows={5}
        aria-label={internal ? "Internal note" : "Reply"}
      />
      <div className="cfoot">
        <span className="muted small grow">
          {internal
            ? "Notes keep the ticket's status."
            : mail.outbound
              ? `Emails ${ticket.requesterEmail} and sets the ticket to pending.`
              : "Email sending isn't set up: the reply is saved on the ticket but not emailed. Sets the ticket to pending."}
        </span>
        <p className="error" role="alert">{error}</p>
        <button className="btn primary" disabled={busy || !body.trim()} onClick={() => void send()}>
          {internal ? <><StickyNote size={15} /> Add note</> : <><Send size={15} /> Send reply</>}
        </button>
      </div>
    </div>
  );
}
