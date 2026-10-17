"use client";
import { Compass, Plus, RotateCcw, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { GroupSummary } from "@/lib/types";
import { KIND_LABEL } from "@/lib/types";
import { api, colorFor, initials } from "./client";
import { CreateGroup } from "./CreateGroup";
import { GroupView } from "./GroupView";

export type MeInfo = { email: string; name: string; admin: boolean; mayCreate: boolean; domain: string };
type Loc = { view: "home" | "discover" | "deleted" } | { view: "group"; id: string };

function locFromUrl(): Loc {
  const m = location.pathname.match(/^\/g\/([0-9a-f-]{36})/i);
  if (m) return { view: "group", id: m[1] };
  const v = new URLSearchParams(location.search).get("view");
  return { view: v === "discover" || v === "deleted" ? v : "home" };
}

function urlFor(loc: Loc): string {
  if (loc.view === "group") return `/g/${loc.id}`;
  return loc.view === "home" ? "/" : `/?view=${loc.view}`;
}

export function GroupAvatar({ name, big }: { name: string; big?: boolean }) {
  return (
    <span className={`avatar${big ? " big" : ""}`} style={{ background: colorFor(name) }} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function GroupsApp({ me, initialId }: { me: MeInfo; initialId?: string }) {
  const [loc, setLoc] = useState<Loc>(initialId ? { view: "group", id: initialId } : { view: "home" });
  const [mine, setMine] = useState<GroupSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(() => {
    api<{ groups: GroupSummary[] }>("/api/groups").then((d) => setMine(d.groups), (e) => setError(e.message));
  }, []);

  useEffect(() => {
    reload();
    setLoc(locFromUrl());
    const onPop = () => setLoc(locFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [reload]);

  const go = (next: Loc) => {
    history.pushState(null, "", urlFor(next));
    setLoc(next);
  };

  const teams = (mine ?? []).filter((g) => g.kind === "team");
  const others = (mine ?? []).filter((g) => g.kind !== "team");
  const selected = loc.view === "group" ? loc.id : null;

  return (
    <div className="app">
      <nav className="nav" aria-label="Groups">
        {me.mayCreate && (
          <button className="btn primary newbtn" onClick={() => setCreating(true)}>
            <Plus size={16} /> Create
          </button>
        )}
        <button className={`navitem${loc.view === "home" ? " active" : ""}`} onClick={() => go({ view: "home" })}>
          <Users size={16} /> All my groups
        </button>
        <button className={`navitem${loc.view === "discover" ? " active" : ""}`} onClick={() => go({ view: "discover" })}>
          <Compass size={16} /> Join a team or group
        </button>
        <div className="navsection">Teams</div>
        {teams.map((g) => (
          <button key={g.id} className={`navitem${selected === g.id ? " active" : ""}`} onClick={() => go({ view: "group", id: g.id })}>
            <span className="fname">{g.name}</span>
          </button>
        ))}
        {mine && !teams.length && <p className="muted small" style={{ padding: "2px 10px", margin: 0 }}>No teams yet</p>}
        {others.length > 0 && <div className="navsection">Groups</div>}
        {others.map((g) => (
          <button key={g.id} className={`navitem${selected === g.id ? " active" : ""}`} onClick={() => go({ view: "group", id: g.id })}>
            <span className="fname">{g.name}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className={`navitem${loc.view === "deleted" ? " active" : ""}`} onClick={() => go({ view: "deleted" })}>
          <Trash2 size={16} /> Deleted groups
        </button>
      </nav>
      <main className="main">
        {error && <p className="error pad">{error}</p>}
        {loc.view === "group" ? (
          <GroupView
            key={loc.id}
            id={loc.id}
            me={me}
            onChanged={reload}
            onGone={() => {
              reload();
              go({ view: "home" });
            }}
          />
        ) : loc.view === "home" ? (
          <Home groups={mine} onOpen={(id) => go({ view: "group", id })} onCreate={me.mayCreate ? () => setCreating(true) : undefined} />
        ) : (
          <Browse view={loc.view} onOpen={(id) => go({ view: "group", id })} onChanged={reload} />
        )}
      </main>
      {creating && (
        <CreateGroup
          me={me}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            reload();
            go({ view: "group", id });
          }}
        />
      )}
    </div>
  );
}

function GroupCard({ g, onOpen, action }: { g: GroupSummary; onOpen: () => void; action?: React.ReactNode }) {
  return (
    <div className="card">
      <button className="top" style={{ all: "unset", cursor: "pointer", display: "flex", gap: 10, alignItems: "center", minWidth: 0 }} onClick={onOpen}>
        <GroupAvatar name={g.name} />
        <span style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
          <b>{g.name}</b>
          <span className="muted small">{KIND_LABEL[g.kind]} · {g.members} member{g.members === 1 ? "" : "s"}</span>
        </span>
      </button>
      {g.description && <p>{g.description}</p>}
      <div className="toolbar">
        {g.privacy === "public" && <span className="pill public">Public</span>}
        {(g.role === "owner" || g.role === "admin") && <span className="pill owner">{g.role === "admin" ? "Admin" : "Owner"}</span>}
        {g.email && <span className="muted small fname">{g.email}</span>}
        {action}
      </div>
    </div>
  );
}

function Home({ groups, onOpen, onCreate }: { groups: GroupSummary[] | null; onOpen: (id: string) => void; onCreate?: () => void }) {
  if (!groups) return <p className="empty">Loading…</p>;
  const teams = groups.filter((g) => g.kind === "team");
  const others = groups.filter((g) => g.kind !== "team");
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Teams and groups</h1>
          <p className="sub muted">A team brings its people a chat, shared files, a calendar and a mailbox. Groups give a set of people one address or one mailbox.</p>
        </div>
      </div>
      <div className="body">
        {!groups.length && (
          <div className="empty">
            <p>You aren&apos;t in any teams or groups yet.</p>
            {onCreate && <button className="btn primary" onClick={onCreate}><Plus size={16} /> Create a team</button>}
          </div>
        )}
        {teams.length > 0 && (
          <section>
            <h3>Your teams</h3>
            <div className="cards">{teams.map((g) => <GroupCard key={g.id} g={g} onOpen={() => onOpen(g.id)} />)}</div>
          </section>
        )}
        {others.length > 0 && (
          <section>
            <h3>Your groups</h3>
            <div className="cards">{others.map((g) => <GroupCard key={g.id} g={g} onOpen={() => onOpen(g.id)} />)}</div>
          </section>
        )}
      </div>
    </>
  );
}

function Browse({ view, onOpen, onChanged }: { view: "discover" | "deleted"; onOpen: (id: string) => void; onChanged: () => void }) {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api<{ groups: GroupSummary[] }>(`/api/groups?view=${view}`).then((d) => setGroups(d.groups), (e) => setError(e.message));
  }, [view]);
  useEffect(load, [load]);

  const shown = (groups ?? []).filter((g) => !filter || `${g.name} ${g.description} ${g.email ?? ""}`.toLowerCase().includes(filter.toLowerCase()));
  const act = async (g: GroupSummary) => {
    setError("");
    try {
      if (view === "deleted") {
        await api(`/api/groups/${g.id}/restore`, { method: "POST" });
        onChanged();
        onOpen(g.id);
        return;
      }
      const out = await api<{ joined: boolean }>(`/api/groups/${g.id}/join`, { method: "POST", json: {} });
      if (out.joined) {
        onChanged();
        onOpen(g.id);
      } else load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>{view === "deleted" ? "Deleted groups" : "Join a team or group"}</h1>
          <p className="sub muted">
            {view === "deleted"
              ? "Groups you owned that were deleted in the last 30 days. Restoring one brings back its chat, files, calendar and mail."
              : "Public teams and groups you can join straight away."}
          </p>
        </div>
        {view === "discover" && <input className="cellin" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter" />}
      </div>
      <div className="body">
        {error && <p className="error">{error}</p>}
        {!groups ? (
          <p className="empty">Loading…</p>
        ) : !shown.length ? (
          <p className="empty">{view === "deleted" ? "Nothing to restore." : "No public teams or groups to join right now."}</p>
        ) : (
          <div className="cards">
            {shown.map((g) => (
              <GroupCard
                key={g.id}
                g={g}
                onOpen={() => view !== "deleted" && onOpen(g.id)}
                action={
                  <button className="btn small" style={{ marginLeft: "auto" }} disabled={g.requested} onClick={() => act(g)}>
                    {view === "deleted" ? <><RotateCcw size={14} /> Restore</> : g.requested ? "Asked to join" : g.privacy === "public" || g.role === "admin" ? "Join" : "Ask to join"}
                  </button>
                }
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
