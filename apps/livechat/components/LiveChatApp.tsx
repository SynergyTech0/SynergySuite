"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Code2, Inbox, LifeBuoy, MessageSquare, Plus, Settings, Trash2, X } from "lucide-react";

type Me = { email: string; admin: boolean };
type Conv = {
  id: string;
  widget_name: string;
  visitor_name: string;
  visitor_email: string;
  page: string;
  status: "open" | "closed";
  assigned_to: string;
  ticket_number: string | null;
  last_at: string;
  last_body?: string | null;
  unread?: number;
};
type Msg = { id: string; sender: "visitor" | "agent" | "system"; body: string; agent_email: string; at: string };
type Widget = { id: string; widget_key: string; name: string; domain: string; greeting: string; color: string; ask_email: boolean; owner_email: string; open_count: number; snippet: string };

async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.json !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

const time = (d: string) => new Date(d).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const visitor = (c: Conv) => c.visitor_name || c.visitor_email || `Visitor ${c.id}`;

export function LiveChatApp({ me, desk }: { me: Me; desk: boolean }) {
  const [tab, setTab] = useState<"open" | "mine" | "closed" | "widgets">("open");
  return (
    <div className="app">
      <nav className="nav">
        <button className={`navitem ${tab === "open" ? "active" : ""}`} onClick={() => setTab("open")}><Inbox size={16} /> Open chats</button>
        <button className={`navitem ${tab === "mine" ? "active" : ""}`} onClick={() => setTab("mine")}><MessageSquare size={16} /> Assigned to me</button>
        <button className={`navitem ${tab === "closed" ? "active" : ""}`} onClick={() => setTab("closed")}><X size={16} /> Closed</button>
        <button className={`navitem ${tab === "widgets" ? "active" : ""}`} onClick={() => setTab("widgets")}><Settings size={16} /> Widgets</button>
      </nav>
      <main className="main">{tab === "widgets" ? <Widgets me={me} /> : <InboxView key={tab} filter={tab} me={me} desk={desk} />}</main>
    </div>
  );
}

function InboxView({ filter, me, desk }: { filter: "open" | "mine" | "closed"; me: Me; desk: boolean }) {
  const [list, setList] = useState<Conv[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    const qs = filter === "closed" ? "status=closed" : filter === "mine" ? "status=open&mine=1" : "status=open";
    return api<{ conversations: Conv[] }>(`/api/conversations?${qs}`).then((r) => setList(r.conversations), (e) => setError(e.message));
  }, [filter]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);
  return (
    <div className="inbox">
      <div className="list">
        <p className="error pad">{error}</p>
        {list && list.length === 0 && <p className="muted pad">No chats here.</p>}
        {list?.map((c) => (
          <button key={c.id} className={`conv ${c.id === sel ? "on" : ""}`} onClick={() => setSel(c.id)}>
            <div className="top">
              <b>{visitor(c)}</b>
              {!!c.unread && <span className="badge">{c.unread}</span>}
              <span className="muted small">{time(c.last_at)}</span>
            </div>
            <div className="last">{c.last_body || ""}</div>
            <div className="muted small">
              {c.widget_name}
              {c.assigned_to ? ` · ${c.assigned_to === me.email ? "you" : c.assigned_to}` : ""}
              {c.ticket_number ? ` · ticket ${c.ticket_number}` : ""}
            </div>
          </button>
        ))}
      </div>
      {sel ? <Thread key={sel} id={sel} me={me} desk={desk} onChanged={load} /> : <div className="pad muted">Pick a chat to answer it.</div>}
    </div>
  );
}

function Thread({ id, me, desk, onChanged }: { id: string; me: Me; desk: boolean; onChanged: () => void }) {
  const [conv, setConv] = useState<Conv | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const load = useCallback(
    () =>
      api<{ conversation: Conv; messages: Msg[] }>(`/api/conversations/${id}`).then(
        (r) => {
          setConv(r.conversation);
          setMsgs((cur) => (cur.length === r.messages.length ? cur : r.messages));
        },
        (e) => setError(e.message),
      ),
    [id],
  );
  useEffect(() => {
    void load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [msgs.length]);

  const act = async (path: string, json?: unknown, done?: (r: unknown) => void) => {
    setError("");
    try {
      const r = await api(`/api/conversations/${id}/${path}`, { method: "POST", json: json ?? {} });
      done?.(r);
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    void act("reply", { body: reply }, () => setReply(""));
  };
  if (!conv) return <div className="pad"><p className="error">{error}</p></div>;
  return (
    <div className="thread">
      <div className="head">
        <div className="grow">
          <h2>{visitor(conv)}</h2>
          <div className="muted small">
            {conv.visitor_email && conv.visitor_name ? `${conv.visitor_email} · ` : ""}
            {conv.widget_name}
            {conv.page ? ` · ${conv.page}` : ""}
          </div>
        </div>
        {conv.assigned_to !== me.email && <button className="btn small" onClick={() => act("assign", { to: me.email })}>Assign to me</button>}
        {desk && !conv.ticket_number && (
          <button
            className="btn small"
            disabled={!conv.visitor_email}
            title={conv.visitor_email ? "Open a Desk ticket with this transcript" : "The visitor hasn't given an email address"}
            onClick={() => act("desk", {}, (r) => setNote(`Opened Desk ticket ${(r as { number: string }).number}`))}
          >
            <LifeBuoy size={14} /> Send to Desk
          </button>
        )}
        {conv.ticket_number && <span className="pill info">Ticket {conv.ticket_number}</span>}
        {conv.status === "open" ? (
          <button className="btn small" onClick={() => act("close")}>Close</button>
        ) : (
          <button className="btn small" onClick={() => act("reopen")}>Reopen</button>
        )}
      </div>
      <p className="error pad" style={{ paddingBottom: 0 }}>{error}</p>
      {note && <p className="ok pad" style={{ paddingBottom: 0 }}>{note}</p>}
      <div className="msgs">
        {msgs.map((m) =>
          m.sender === "system" ? (
            <div key={m.id} className="sys">{m.body}</div>
          ) : (
            <div key={m.id} className={`bubble ${m.sender}`}>
              {m.body}
              <div className="meta">{m.sender === "agent" ? `${m.agent_email} · ` : ""}{time(m.at)}</div>
            </div>
          ),
        )}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={send}>
        <textarea
          value={reply}
          placeholder="Write a reply…"
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(e);
            }
          }}
        />
        <button className="btn primary">Send</button>
      </form>
    </div>
  );
}

function Widgets({ me }: { me: Me }) {
  const [list, setList] = useState<Widget[] | null>(null);
  const [editing, setEditing] = useState<Partial<Widget> | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api<{ widgets: Widget[] }>("/api/widgets").then((r) => setList(r.widgets), (e) => setError(e.message)), []);
  useEffect(() => void load(), [load]);
  const remove = async (w: Widget) => {
    if (!confirm(`Delete ${w.name} and all of its chats?`)) return;
    try {
      await api(`/api/widgets/${w.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <div className="head">
        <h1 className="grow">Widgets</h1>
        {me.admin && <button className="btn primary" onClick={() => setEditing({ color: "#0f6cbd", greeting: "Hi! How can we help?", ask_email: true })}><Plus size={16} /> New widget</button>}
      </div>
      <div className="body">
        <p className="error">{error}</p>
        {list && list.length === 0 && <div className="empty">No widgets yet.{me.admin ? " Add one for each website that should show a chat bubble." : " Ask a LiveChat admin to add one."}</div>}
        {list && list.length > 0 && (
          <table className="grid">
            <thead><tr><th>Widget</th><th>Domain</th><th className="num">Open chats</th><th /></tr></thead>
            <tbody>
              {list.map((w) => (
                <tr key={w.id}>
                  <td><span className="swatch" style={{ background: w.color }} /> <b>{w.name}</b><div className="muted small">{w.greeting}</div></td>
                  <td>{w.domain || <span className="muted">any site</span>}</td>
                  <td className="num">{w.open_count}</td>
                  <td className="num" style={{ whiteSpace: "nowrap" }}>
                    <button className="iconbtn" title="Snippet" onClick={() => setCode(w.snippet)}><Code2 size={15} /></button>
                    {me.admin && <button className="iconbtn" title="Edit" onClick={() => setEditing(w)}><Settings size={15} /></button>}
                    {me.admin && <button className="iconbtn" title="Delete" onClick={() => remove(w)}><Trash2 size={15} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {code && (
          <div className="card">
            <h3>Add this to every page that should show the chat bubble</h3>
            <pre className="code mono">{code}</pre>
            <p className="muted small">In Sites, paste the widget key into a site&apos;s live chat setting instead.</p>
          </div>
        )}
      </div>
      {editing && (
        <WidgetForm
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </>
  );
}

function WidgetForm({ initial, onClose, onSaved }: { initial: Partial<Widget>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: initial.name ?? "", domain: initial.domain ?? "", greeting: initial.greeting ?? "", color: initial.color ?? "#0f6cbd", askEmail: initial.ask_email ?? true });
  const [err, setErr] = useState("");
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (initial.id) await api(`/api/widgets/${initial.id}`, { method: "PATCH", json: f });
      else await api("/api/widgets", { method: "POST", json: f });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="scrim" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="modalhead">
          <h2>{initial.id ? "Edit widget" : "New widget"}</h2>
          <button type="button" className="iconbtn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="form">
          <label><span>Name (shown at the top of the chat)</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus required /></label>
          <label><span>Website domain</span><input value={f.domain} placeholder="example.com" onChange={(e) => setF({ ...f, domain: e.target.value })} /></label>
          <label><span>Greeting</span><input value={f.greeting} onChange={(e) => setF({ ...f, greeting: e.target.value })} /></label>
          <label><span>Colour</span><input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={f.askEmail} onChange={(e) => setF({ ...f, askEmail: e.target.checked })} /> Ask visitors for their name and email</label>
          <p className="muted small">With a domain, the chat only works on pages on it and its subdomains. Desk needs the visitor&apos;s email to open a ticket.</p>
          <p className="error">{err}</p>
          <div className="actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary">Save</button>
          </div>
        </div>
      </form>
    </div>
  );
}
