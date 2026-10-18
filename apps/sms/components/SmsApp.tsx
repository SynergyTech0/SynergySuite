"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Megaphone, MessageSquare, Plus, Send, Trash2, Upload, Users, X } from "lucide-react";

type Sender = { provider: string; configured: boolean; from: string };
type Conversation = { phone: string; name: string | null; opted_out: boolean | null; last_body: string; last_dir: string; last_at: string; unread: number };
type Contact = { id: string; phone: string; name: string; tags: string[]; opted_out: boolean; created_at: string };
type Message = { id: string; phone: string; direction: "in" | "out"; body: string; status: string; error: string; sent_by: string; at: string };
type Thread = { phone: string; contact: Contact | null; messages: Message[] };
type Campaign = {
  id: string;
  name: string;
  body: string;
  tag: string;
  recipients: number;
  status: string;
  created_by: string;
  created_at: string;
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
};
type Stats = { contacts: number; opted_out: number; sent_30d: number; received_30d: number; unread: number };

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data as T;
}

const api = {
  dashboard: () => call<Stats>("GET", "/api/dashboard"),
  conversations: () => call<Conversation[]>("GET", "/api/conversations"),
  thread: (phone: string) => call<Thread>("GET", `/api/conversations/${encodeURIComponent(phone)}`),
  send: (to: string, body: string) => call<Message>("POST", "/api/send", { to, body }),
  contacts: (q = "") => call<Contact[]>("GET", `/api/contacts?q=${encodeURIComponent(q)}`),
  addContact: (c: object) => call<Contact>("POST", "/api/contacts", c),
  updateContact: (id: string, c: object) => call<Contact>("PATCH", `/api/contacts/${id}`, c),
  deleteContact: (id: string) => call("DELETE", `/api/contacts/${id}`),
  importContacts: (csv: string) => call<{ created: number; updated: number; skipped: number }>("POST", "/api/contacts/import", { csv }),
  campaigns: () => call<Campaign[]>("GET", "/api/campaigns"),
  audience: (tag: string) => call<{ count: number }>("GET", `/api/campaigns?audience=${encodeURIComponent(tag)}`),
  createCampaign: (c: object) => call<Campaign>("POST", "/api/campaigns", c),
};

const when = (ts: string) => new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const segments = (s: string) => (s.length <= 160 ? 1 : Math.ceil(s.length / 153));

export function SmsApp({ sender }: { sender: Sender }) {
  const [view, setView] = useState<"inbox" | "contacts" | "campaigns">("inbox");
  const [stats, setStats] = useState<Stats | null>(null);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [modal, setModal] = useState<"new" | null>(null);
  const [toast, setToast] = useState("");

  const flash = useCallback((e: unknown) => {
    setToast(e instanceof Error ? e.message : String(e));
    setTimeout(() => setToast(""), 6000);
  }, []);

  const refresh = useCallback(() => {
    api.conversations().then(setConvs).catch(() => {});
    api.dashboard().then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    const p = new URLSearchParams(location.search).get("phone");
    if (p) setActive(p);
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="app">
      <aside className="side">
        <div className="tabs">
          <button className={view === "inbox" ? "on" : ""} onClick={() => setView("inbox")}>
            <MessageSquare size={14} /> Inbox
          </button>
          <button className={view === "contacts" ? "on" : ""} onClick={() => setView("contacts")}>
            <Users size={14} /> Contacts
          </button>
          <button className={view === "campaigns" ? "on" : ""} onClick={() => setView("campaigns")}>
            <Megaphone size={14} /> Campaigns
          </button>
        </div>
        <div className={`from small${sender.configured ? " muted" : " warn"}`}>
          {sender.configured ? `Texts go from ${sender.from}` : "No texting service is set up, so nothing can be sent."}
        </div>
        {stats && (
          <div className="stats small muted">
            {stats.contacts} contacts · {stats.opted_out} opted out
            <br />
            {stats.sent_30d} sent · {stats.received_30d} received in 30 days
          </div>
        )}
        <div className="convs">
          <div style={{ padding: 10 }}>
            <button className="btn primary small" onClick={() => setModal("new")} disabled={!sender.configured}>
              <Plus size={14} /> New text
            </button>
          </div>
          {convs.map((c) => (
            <div
              key={c.phone}
              className={`conv${active === c.phone && view === "inbox" ? " on" : ""}`}
              onClick={() => {
                setActive(c.phone);
                setView("inbox");
              }}
            >
              <div className="top">
                <b className="fname">{c.name || c.phone}</b>
                {c.opted_out && <span className="badge grey">opted out</span>}
                {c.unread > 0 && <span className="badge">{c.unread}</span>}
              </div>
              <div className="last small">
                {c.last_dir === "out" ? "You: " : ""}
                {c.last_body}
              </div>
            </div>
          ))}
          {!convs.length && <p className="muted pad small">No conversations yet.</p>}
        </div>
      </aside>
      <main className="main">
        {view === "inbox" &&
          (active ? (
            <ThreadView key={active} phone={active} canSend={sender.configured} flash={flash} onChange={refresh} />
          ) : (
            <div className="empty">Pick a conversation, or start a new text.</div>
          ))}
        {view === "contacts" && (
          <ContactsView
            flash={flash}
            onOpen={(p) => {
              setActive(p);
              setView("inbox");
            }}
          />
        )}
        {view === "campaigns" && <CampaignsView flash={flash} canSend={sender.configured} />}
      </main>
      {modal === "new" && (
        <NewText
          onClose={() => setModal(null)}
          onSend={async (to, body) => {
            try {
              const m = await api.send(to, body);
              setModal(null);
              setActive(m.phone);
              setView("inbox");
              refresh();
            } catch (e) {
              flash(e);
            }
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function ThreadView({ phone, canSend, flash, onChange }: { phone: string; canSend: boolean; flash: (e: unknown) => void; onChange: () => void }) {
  const [t, setT] = useState<Thread | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const load = useCallback(() => api.thread(phone).then(setT), [phone]);

  useEffect(() => {
    load().catch(flash);
    const timer = setInterval(() => load().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [load, flash]);
  const count = t?.messages.length ?? 0;
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [count]);

  const send = async () => {
    const body = reply.trim();
    if (!body) return;
    setBusy(true);
    try {
      await api.send(phone, body);
      setReply("");
      await load();
      onChange();
    } catch (e) {
      flash(e);
    } finally {
      setBusy(false);
    }
  };

  const optedOut = Boolean(t?.contact?.opted_out);
  return (
    <>
      <div className="head">
        <b>{t?.contact?.name || phone}</b>
        {t?.contact?.name && <span className="muted mono small">{phone}</span>}
        {optedOut && <span className="badge grey">opted out</span>}
      </div>
      <div className="thread" ref={list}>
        {t?.messages.map((m) => (
          <div key={m.id} className={`bubble ${m.direction}`}>
            {m.body}
            <div className="meta">
              {when(m.at)}
              {m.direction === "out" && m.status && m.status !== "delivered" ? ` · ${m.status}` : ""}
              {m.error ? ` · ${m.error}` : ""}
            </div>
          </div>
        ))}
        {t && !t.messages.length && <p className="muted">No texts yet.</p>}
      </div>
      <div className="composer">
        <textarea
          value={reply}
          placeholder={optedOut ? "This number replied STOP. They can text START to opt back in." : canSend ? "Write a text" : "No texting service is set up"}
          disabled={optedOut || !canSend}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <span className="muted small">{reply ? `${reply.length} · ${segments(reply)} SMS` : ""}</span>
        <button className="btn primary" disabled={busy || !reply.trim() || optedOut || !canSend} onClick={send}>
          <Send size={14} /> Send
        </button>
      </div>
    </>
  );
}

function ContactsView({ flash, onOpen }: { flash: (e: unknown) => void; onOpen: (phone: string) => void }) {
  const [rows, setRows] = useState<Contact[] | null>(null);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<"add" | "import" | null>(null);
  const load = useCallback(() => api.contacts(search).then(setRows).catch(flash), [search, flash]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="pane">
      <div className="bar">
        <h1>Contacts</h1>
        <input className="search" placeholder="Search name, number or tag" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn" onClick={() => setModal("import")}>
          <Upload size={14} /> Import CSV
        </button>
        <button className="btn primary" onClick={() => setModal("add")}>
          <Plus size={14} /> Contact
        </button>
      </div>
      <table className="list">
        <thead>
          <tr>
            <th>Name</th>
            <th>Number</th>
            <th>Tags</th>
            <th>Opted out</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows?.map((c) => (
            <tr key={c.id}>
              <td>
                <a href="#" onClick={(e) => (e.preventDefault(), onOpen(c.phone))}>
                  {c.name || "(no name)"}
                </a>
              </td>
              <td className="mono">{c.phone}</td>
              <td>
                {c.tags.map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={c.opted_out}
                  title="Opted out: never texted, campaigns included"
                  onChange={(e) =>
                    api
                      .updateContact(c.id, { optedOut: e.target.checked })
                      .then(load)
                      .catch(flash)
                  }
                />
              </td>
              <td>
                <button
                  className="iconbtn small"
                  title="Delete contact"
                  onClick={() => {
                    if (confirm(`Delete ${c.name || c.phone}? Their texts stay in the inbox.`)) api.deleteContact(c.id).then(load).catch(flash);
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          ))}
          {rows && !rows.length && (
            <tr>
              <td colSpan={5} className="muted">
                {search ? "Nothing matches." : "No contacts yet. Add one or import a CSV."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {modal === "add" && (
        <AddContact
          onClose={() => setModal(null)}
          onSave={async (c) => {
            try {
              await api.addContact(c);
              setModal(null);
              await load();
            } catch (e) {
              flash(e);
            }
          }}
        />
      )}
      {modal === "import" && (
        <ImportContacts
          onClose={() => setModal(null)}
          onImport={async (csv) => {
            try {
              const r = await api.importContacts(csv);
              setModal(null);
              flash(`Added ${r.created}, updated ${r.updated}, skipped ${r.skipped} without a usable number`);
              await load();
            } catch (e) {
              flash(e);
            }
          }}
        />
      )}
    </div>
  );
}

function CampaignsView({ flash, canSend }: { flash: (e: unknown) => void; canSend: boolean }) {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => api.campaigns().then(setRows).catch(flash), [flash]);
  const sending = rows.some((c) => c.status === "sending");
  useEffect(() => {
    void load();
    if (!sending) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load, sending]);

  return (
    <div className="pane">
      <div className="bar">
        <h1>Campaigns</h1>
        <button className="btn primary" onClick={() => setCreating(true)} disabled={!canSend}>
          <Plus size={14} /> New campaign
        </button>
      </div>
      <p className="muted small">
        A campaign texts every contact (or everyone with one tag), one a second. Contacts who opted out are always skipped, including anyone who replies
        STOP while it is sending.
      </p>
      {rows.map((c) => (
        <div key={c.id} className="card">
          <div>
            <b>{c.name}</b> <span className="muted small">{when(c.created_at)} by {c.created_by}</span>
          </div>
          <div className="body">{c.body}</div>
          <div className="muted small">
            {c.tag ? `Tag "${c.tag}" · ` : ""}
            {c.recipients} recipients · {c.sent} sent{c.failed ? ` · ${c.failed} failed` : ""}
            {c.skipped ? ` · ${c.skipped} skipped` : ""}
            {c.status === "sending" ? ` · sending, ${c.pending} to go` : ""}
          </div>
        </div>
      ))}
      {!rows.length && <p className="muted">No campaigns yet.</p>}
      {creating && (
        <NewCampaign
          onClose={() => setCreating(false)}
          onSend={async (c) => {
            try {
              await api.createCampaign(c);
              setCreating(false);
              await load();
            } catch (e) {
              flash(e);
            }
          }}
        />
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modalhead">
          <h2>{title}</h2>
          <button className="iconbtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="form">{children}</div>
      </div>
    </div>
  );
}

function Actions({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="actions">
      <button className="btn" onClick={onClose}>
        Cancel
      </button>
      {children}
    </div>
  );
}

function NewText({ onClose, onSend }: { onClose: () => void; onSend: (to: string, body: string) => void }) {
  const [to, setTo] = useState("");
  const [body, setBody] = useState("");
  return (
    <Modal title="New text" onClose={onClose}>
      <label>
        <span>To</span>
        <input autoFocus value={to} onChange={(e) => setTo(e.target.value)} placeholder="+1 555 123 4567" />
      </label>
      <label>
        <span>Message</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <Actions onClose={onClose}>
        <button className="btn primary" disabled={!to.trim() || !body.trim()} onClick={() => onSend(to, body)}>
          Send
        </button>
      </Actions>
    </Modal>
  );
}

function AddContact({ onClose, onSave }: { onClose: () => void; onSave: (c: { name: string; phone: string; tags: string }) => void }) {
  const [f, setF] = useState({ name: "", phone: "", tags: "" });
  return (
    <Modal title="New contact" onClose={onClose}>
      <label>
        <span>Name</span>
        <input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </label>
      <label>
        <span>Number</span>
        <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      </label>
      <label>
        <span>Tags, separated by commas</span>
        <input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="vip, newsletter" />
      </label>
      <Actions onClose={onClose}>
        <button className="btn primary" disabled={!f.phone.trim()} onClick={() => onSave(f)}>
          Add
        </button>
      </Actions>
    </Modal>
  );
}

function ImportContacts({ onClose, onImport }: { onClose: () => void; onImport: (csv: string) => void }) {
  const [csv, setCsv] = useState("");
  return (
    <Modal title="Import contacts" onClose={onClose}>
      <p className="muted small">One contact per line: number, name, tags (tags in quotes when there are several). A header row is fine.</p>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) setCsv(await file.text());
        }}
      />
      <textarea className="csv" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'+15551234567,Jane Doe,"vip, newsletter"'} />
      <Actions onClose={onClose}>
        <button className="btn primary" disabled={!csv.trim()} onClick={() => onImport(csv)}>
          Import
        </button>
      </Actions>
    </Modal>
  );
}

function NewCampaign({ onClose, onSend }: { onClose: () => void; onSend: (c: { name: string; body: string; tag: string }) => void }) {
  const [f, setF] = useState({ name: "", body: "", tag: "" });
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      api
        .audience(f.tag)
        .then((r) => setCount(r.count))
        .catch(() => setCount(null));
    }, 250);
    return () => clearTimeout(t);
  }, [f.tag]);
  return (
    <Modal title="New campaign" onClose={onClose}>
      <label>
        <span>Name</span>
        <input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </label>
      <label>
        <span>Message</span>
        <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
      </label>
      <label>
        <span>Only contacts tagged (optional)</span>
        <input value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} placeholder="Everyone" />
      </label>
      <p className="muted small">
        This sends real texts to {count ?? "…"} {count === 1 ? "person" : "people"}
        {f.body ? `, ${segments(f.body)} SMS each` : ""}. Your provider charges for each one.
      </p>
      <Actions onClose={onClose}>
        <button
          className="btn primary"
          disabled={!f.name.trim() || !f.body.trim() || !count}
          onClick={() => {
            if (confirm(`Text ${count} ${count === 1 ? "person" : "people"} now?`)) onSend(f);
          }}
        >
          Send campaign
        </button>
      </Actions>
    </Modal>
  );
}
