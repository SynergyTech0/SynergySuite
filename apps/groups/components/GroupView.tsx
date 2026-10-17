"use client";
import { CalendarDays, ExternalLink, FileText, Folder, Hash, Mail, MessageSquare, Plus, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { GroupDetail, Kind } from "@/lib/types";
import { KIND_LABEL } from "@/lib/types";
import { ago, api, colorFor, initials, localInput, person, size } from "./client";
import { GroupAvatar, type MeInfo } from "./GroupsApp";
import { Members } from "./Members";
import { Modal } from "./Modal";
import { Settings } from "./Settings";

type Tab = "posts" | "files" | "calendar" | "members" | "settings";

const APP_LABEL: Record<string, string> = { chat: "Chat", drive: "Files", calendar: "Calendar", mail: "Mailbox", sites: "Site" };

function tabsFor(kind: Kind, owner: boolean, inGroup: boolean): Tab[] {
  if (!inGroup) return ["members"];
  const t: Tab[] = kind === "team" ? ["posts", "files", "calendar", "members"] : ["members"];
  if (owner) t.push("settings");
  return t;
}

const TAB_LABEL: Record<Tab, string> = { posts: "Posts", files: "Files", calendar: "Calendar", members: "Members", settings: "Settings" };

export function GroupView({ id, me, onChanged, onGone }: { id: string; me: MeInfo; onChanged: () => void; onGone: () => void }) {
  const [g, setG] = useState<GroupDetail | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<GroupDetail>(`/api/groups/${id}`).then(setG, (e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  // A new group is set up in the other apps in the background: look again until it is.
  useEffect(() => {
    if (!g || g.syncedAt) return;
    const t = setTimeout(load, 2500);
    return () => clearTimeout(t);
  }, [g, load]);

  if (error) return <p className="error pad">{error}</p>;
  if (!g) return <p className="empty">Loading…</p>;

  const owner = g.role === "owner" || g.role === "admin";
  const inGroup = !!g.role;
  const tabs = tabsFor(g.kind, owner, inGroup);
  const current = tab && tabs.includes(tab) ? tab : tabs[0];
  const changed = (next?: GroupDetail) => {
    if (next) setG(next);
    else load();
    onChanged();
  };
  const links = g.resources.filter((r) => r.url && r.status === "ok");

  return (
    <>
      <div className="head">
        <GroupAvatar name={g.name} big />
        <div className="grow">
          <h1>{g.name}</h1>
          <p className="sub muted">
            {KIND_LABEL[g.kind]} · {g.privacy === "public" ? "Public" : "Private"} · {g.members} member{g.members === 1 ? "" : "s"}
            {g.email ? <> · <a href={`mailto:${g.email}`}>{g.email}</a></> : null}
          </p>
          {g.description && <p style={{ margin: "6px 0 0" }}>{g.description}</p>}
        </div>
        <div className="toolbar">
          {links.map((r) => (
            <a key={r.app} className="btn small" href={r.url} target={`synergy-${r.app}`} rel="noopener">
              <ExternalLink size={14} /> {APP_LABEL[r.app] ?? r.name ?? r.app}
            </a>
          ))}
          {!inGroup && (
            <JoinButton
              g={g}
              onDone={(joined) => {
                if (joined) changed();
                else load();
              }}
            />
          )}
        </div>
      </div>
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={current === t} className={`tab${current === t ? " on" : ""}`} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
            {t === "members" && owner && g.requests.length > 0 ? ` (${g.requests.length})` : ""}
          </button>
        ))}
      </div>
      <div className="body">
        {current === "posts" && <Posts g={g} me={me} onChanged={changed} />}
        {current === "files" && <Files g={g} />}
        {current === "calendar" && <Calendar g={g} />}
        {current === "members" && <Members g={g} me={me} onChanged={changed} onLeft={onGone} />}
        {current === "settings" && <Settings g={g} onChanged={changed} onDeleted={onGone} />}
        {current !== "settings" && current !== "members" && <SetupState g={g} owner={owner} onSynced={setG} />}
      </div>
    </>
  );
}

function JoinButton({ g, onDone }: { g: GroupDetail; onDone: (joined: boolean) => void }) {
  const [error, setError] = useState("");
  return (
    <>
      <button
        className="btn primary small"
        disabled={g.requested}
        onClick={async () => {
          try {
            const out = await api<{ joined: boolean }>(`/api/groups/${g.id}/join`, { method: "POST", json: {} });
            onDone(out.joined);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        {g.requested ? "Asked to join" : g.privacy === "public" ? "Join" : "Ask to join"}
      </button>
      {error && <span className="error small">{error}</span>}
    </>
  );
}

/** Where the team's chat, files, calendar and mailbox stand, when something isn't working. */
function SetupState({ g, owner, onSynced }: { g: GroupDetail; owner: boolean; onSynced: (g: GroupDetail) => void }) {
  const [busy, setBusy] = useState(false);
  const broken = g.resources.filter((r) => r.status === "error");
  if (!g.syncedAt) return <p className="muted small">Setting up this team in Chat, Drive, Calendar and Mail…</p>;
  if (!broken.length) return null;
  return (
    <div className="notice">
      {broken.map((r) => (
        <div key={r.app}>
          <b>{APP_LABEL[r.app] ?? r.app}:</b> {r.error || "isn't set up yet"}
        </div>
      ))}
      {owner && (
        <button
          className="btn small"
          style={{ marginTop: 8 }}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              onSynced(await api<GroupDetail>(`/api/groups/${g.id}/sync`, { method: "POST" }));
            } finally {
              setBusy(false);
            }
          }}
        >
          <RefreshCw size={14} /> Try again
        </button>
      )}
    </div>
  );
}

type Post = { id: number; channelKey: string; channelName: string; author: { email: string; name: string }; body: string; createdAt: string; replyCount: number; url: string };

function Posts({ g, me, onChanged }: { g: GroupDetail; me: MeInfo; onChanged: (g: GroupDetail) => void }) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [note, setNote] = useState("");
  const [channel, setChannel] = useState(g.channels[0]?.key ?? "general");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api<{ messages: Post[]; error?: string }>(`/api/groups/${g.id}/posts?limit=30`).then(
      (d) => {
        setPosts(d.messages);
        setNote(d.error ?? "");
      },
      (e) => setNote(e.message),
    );
  }, [g.id]);
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="split">
      <div className="posts">
        <form
          className="composer"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim()) return;
            setBusy(true);
            try {
              await api(`/api/groups/${g.id}/posts`, { method: "POST", json: { channelKey: channel, body: text } });
              setText("");
              load();
            } catch (x) {
              setNote((x as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Start a conversation" aria-label="New conversation" maxLength={8000} />
          <div className="row">
            <select className="cellin" value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel">
              {g.channels.map((c) => <option key={c.key} value={c.key}>#{c.name}</option>)}
            </select>
            <button className="btn primary small" disabled={busy || !text.trim()}><Send size={14} /> Post</button>
          </div>
        </form>
        {note && <p className="muted small">{note === "Not set up yet" ? "The team's chat is still being set up." : note}</p>}
        {posts === null ? (
          <p className="empty">Loading…</p>
        ) : !posts.length ? (
          <p className="empty">No conversations yet. Say hello to the team.</p>
        ) : (
          posts.map((p) => (
            <div key={p.id} className="post">
              <span className="avatar round" style={{ background: colorFor(p.author.email) }}>{initials(p.author.name || p.author.email)}</span>
              <div className="grow">
                <div className="meta">
                  <b>{p.author.email === me.email ? "You" : p.author.name || person(p.author.email)}</b>
                  <span>#{p.channelName}</span>
                  <span>{ago(p.createdAt)}</span>
                </div>
                <div className="text">{p.body}</div>
                <a className="small" href={p.url} target="synergy-chat" rel="noopener">
                  {p.replyCount ? `${p.replyCount} repl${p.replyCount === 1 ? "y" : "ies"}` : "Reply"} in Chat
                </a>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="box">
        <h2>
          <span>Channels</span>
          <button className="iconbtn small" aria-label="Add a channel" title="Add a channel" onClick={() => setAdding(true)}><Plus size={16} /></button>
        </h2>
        <div className="list">
          {g.channels.map((c) => (
            <div key={c.key} className="item">
              <Hash size={15} className="muted" />
              {c.url ? <a className="fname" href={c.url} target="synergy-chat" rel="noopener">{c.name}</a> : <span className="fname">{c.name}</span>}
              {c.topic && <span className="muted small fname">{c.topic}</span>}
            </div>
          ))}
        </div>
        {g.email && (
          <p className="muted small" style={{ margin: 0 }}>
            <Mail size={13} style={{ verticalAlign: -2 }} /> Mail to <a href={`mailto:${g.email}`}>{g.email}</a> lands in the team&apos;s shared mailbox in Mail.
          </p>
        )}
        <p className="muted small" style={{ margin: 0 }}>
          <MessageSquare size={13} style={{ verticalAlign: -2 }} /> Each channel is also in Chat, under the team&apos;s workspace.
        </p>
      </div>
      {adding && <AddChannel g={g} onClose={() => setAdding(false)} onAdded={onChanged} />}
    </div>
  );
}

function AddChannel({ g, onClose, onAdded }: { g: GroupDetail; onClose: () => void; onAdded: (g: GroupDetail) => void }) {
  const [error, setError] = useState("");
  return (
    <Modal title="Add a channel" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            onAdded(await api<GroupDetail>(`/api/groups/${g.id}/channels`, { method: "POST", json: { name: f.get("name"), topic: f.get("topic") } }));
            onClose();
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        <label><span>Name</span><input name="name" maxLength={50} required autoFocus /></label>
        <label><span>What it&apos;s for (optional)</span><input name="topic" maxLength={250} /></label>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Add</button>
        </div>
      </form>
    </Modal>
  );
}

type FileItem = { id: string; name: string; kind: "file" | "folder"; mime: string; size: number; modifiedAt: string; modifiedBy: string; url: string };

function Files({ g }: { g: GroupDetail }) {
  const [items, setItems] = useState<FileItem[] | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    api<{ items: FileItem[]; error?: string }>(`/api/groups/${g.id}/files?limit=25`).then(
      (d) => {
        setItems(d.items);
        setNote(d.error ?? "");
      },
      (e) => setNote(e.message),
    );
  }, [g.id]);
  const library = g.resources.find((r) => r.app === "drive" && r.status === "ok");
  return (
    <div className="box">
      <h2>
        <span>Recent files</span>
        {library && <a className="btn small" href={library.url} target="synergy-drive" rel="noopener"><Folder size={14} /> Open in Drive</a>}
      </h2>
      {note && <p className="muted small">{note === "Not set up yet" ? "The team's library is still being set up." : note}</p>}
      {items === null ? (
        <p className="empty">Loading…</p>
      ) : !items.length ? (
        <p className="empty">No files yet. Open the library in Drive to upload some; everyone in the team can edit them.</p>
      ) : (
        <div className="list">
          {items.map((f) => (
            <div key={f.id} className="item">
              {f.kind === "folder" ? <Folder size={16} className="muted" /> : <FileText size={16} className="muted" />}
              <a className="fname" href={f.url} target="synergy-drive" rel="noopener">{f.name}</a>
              <span className="muted small">{size(f.size)}</span>
              <span className="muted small" style={{ minWidth: 120, textAlign: "right" }}>{person(f.modifiedBy)} · {ago(f.modifiedAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type CalEvent = { id: number; title: string; location: string; start_at: string; end_at: string; all_day: boolean; owner_email: string };

function Calendar({ g }: { g: GroupDetail }) {
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => {
    api<{ events: CalEvent[]; error?: string }>(`/api/groups/${g.id}/events`).then(
      (d) => {
        setEvents(d.events);
        setNote(d.error ?? "");
      },
      (e) => setNote(e.message),
    );
  }, [g.id]);
  useEffect(load, [load]);
  const cal = g.resources.find((r) => r.app === "calendar" && r.status === "ok");
  return (
    <div className="box">
      <h2>
        <span>Next four weeks</span>
        <span className="toolbar">
          {cal && <a className="btn small" href={cal.url} target="synergy-calendar" rel="noopener"><CalendarDays size={14} /> Open Calendar</a>}
          <button className="btn primary small" onClick={() => setAdding(true)}><Plus size={14} /> New meeting</button>
        </span>
      </h2>
      {note && <p className="muted small">{note === "Not set up yet" ? "The team calendar is still being set up." : note}</p>}
      {events === null ? (
        <p className="empty">Loading…</p>
      ) : !events.length ? (
        <p className="empty">Nothing on the team calendar. Meetings added here show in everyone&apos;s Calendar.</p>
      ) : (
        <div className="list">
          {events.map((e) => {
            const s = new Date(e.start_at);
            return (
              <div key={e.id} className="item">
                <div className="when"><span>{s.toLocaleDateString([], { month: "short" })}</span><b>{s.getDate()}</b></div>
                <div className="grow">
                  <div className="fname"><b>{e.title}</b></div>
                  <div className="muted small">
                    {e.all_day ? "All day" : `${s.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} to ${new Date(e.end_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
                    {e.location ? ` · ${e.location}` : ""} · {person(e.owner_email)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {adding && <NewMeeting g={g} onClose={() => setAdding(false)} onAdded={load} />}
    </div>
  );
}

function NewMeeting({ g, onClose, onAdded }: { g: GroupDetail; onClose: () => void; onAdded: () => void }) {
  const [error, setError] = useState("");
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 3600_000);
  return (
    <Modal title="New team meeting" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await api(`/api/groups/${g.id}/events`, {
              method: "POST",
              json: {
                title: f.get("title"),
                location: f.get("location"),
                description: f.get("description"),
                startAt: new Date(String(f.get("start"))).toISOString(),
                endAt: new Date(String(f.get("end"))).toISOString(),
              },
            });
            onAdded();
            onClose();
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        <label><span>Title</span><input name="title" maxLength={300} required autoFocus /></label>
        <div className="row2">
          <label><span>Starts</span><input type="datetime-local" name="start" defaultValue={localInput(start)} required /></label>
          <label><span>Ends</span><input type="datetime-local" name="end" defaultValue={localInput(end)} required /></label>
        </div>
        <label><span>Location or link</span><input name="location" maxLength={300} /></label>
        <label><span>Notes</span><textarea name="description" maxLength={2000} rows={3} /></label>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Add to team calendar</button>
        </div>
      </form>
    </Modal>
  );
}
