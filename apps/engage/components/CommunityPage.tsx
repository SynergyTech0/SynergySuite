"use client";
import { Globe, Lock, MessagesSquare, Settings, Sparkles, Users, BadgeCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Community, Post } from "@/lib/types";
import { COLORS } from "@/lib/types";
import { Avatar, PeoplePicker } from "./bits";
import { COLOR_HEX, api } from "./client";
import { CatchUp } from "./CatchUp";
import { Composer } from "./Composer";
import { Feed } from "./Feed";
import { Confirm, Modal } from "./Modal";
import { useApp } from "./Shell";

type Member = { email: string; name: string; role: "admin" | "member"; joinedAt: string };

export function CommunityPage({ slug }: { slug: string }) {
  const { me, ai, say, communities, reloadCommunities } = useApp();
  const router = useRouter();
  const [c, setC] = useState<Community | null>(null);
  const [missing, setMissing] = useState(false);
  const [posted, setPosted] = useState<Post | null>(null);
  const [dialog, setDialog] = useState<"members" | "settings" | null>(null);

  const load = useCallback(async () => {
    try {
      setC(await api<Community>(`/api/communities/${encodeURIComponent(slug)}`));
    } catch {
      setMissing(true);
    }
  }, [slug]);
  useEffect(() => {
    void load();
  }, [load]);

  if (missing) return <div className="empty"><p>This community doesn&apos;t exist, or it&apos;s private.</p></div>;
  if (!c) return <p className="muted center pad">Loading…</p>;

  const membership = async (what: "join" | "leave") => {
    try {
      await api(`/api/communities/${c.id}/${what}`, { method: "POST" });
      await Promise.all([load(), reloadCommunities()]);
      say(what === "join" ? `You joined ${c.name}` : `You left ${c.name}`);
    } catch (e) {
      say((e as Error).message);
    }
  };

  return (
    <div className="column">
      <div className="cbanner" style={{ background: COLOR_HEX[c.color] }}>
        <span className="cdot huge" style={{ color: COLOR_HEX[c.color] }}>{c.name[0]}</span>
      </div>
      <div className="head chead">
        <div className="titlerow">
          <h1>{c.name}</h1>
          {c.official && <span title="Official community"><BadgeCheck size={18} color={COLOR_HEX.blue} /></span>}
          <span className="grow" />
          {ai && <CatchUp community={c.id} label={<><Sparkles size={15} /> Catch me up</>} />}
          {c.canManage && <button className="btn small" onClick={() => setDialog("settings")}><Settings size={15} /> Settings</button>}
          {!c.myRole && c.privacy === "public" && <button className="btn primary small" onClick={() => void membership("join")}>Join</button>}
          {c.myRole && c.slug !== "all-company" && <button className="btn small" onClick={() => void membership("leave")}>Leave</button>}
        </div>
        {c.description && <p>{c.description}</p>}
        <div className="cmeta muted small">
          <span>{c.privacy === "private" ? <><Lock size={13} /> Private</> : <><Globe size={13} /> Public</>}</span>
          <button className="linkbtn small" onClick={() => setDialog("members")}><Users size={13} /> {c.members} {c.members === 1 ? "member" : "members"}</button>
          {c.chatUrl && <a className="linkbtn small" href={c.chatUrl}><MessagesSquare size={13} /> {c.chatName ? `#${c.chatName}` : "Chat channel"}</a>}
          {c.siteUrl && <a className="linkbtn small" href={c.siteUrl} target="_blank" rel="noreferrer noopener"><Globe size={13} /> Site</a>}
        </div>
      </div>
      {(c.myRole || me.admin) && <Composer me={me} communities={communities} fixed={c} onPosted={setPosted} say={say} />}
      <Feed params={{ view: "community", community: c.id }} prepend={posted} empty={<p>No conversations yet. Start one.</p>} />
      {dialog === "members" && <Members c={c} onClose={() => { setDialog(null); void load(); }} />}
      {dialog === "settings" && (
        <SettingsDialog c={c} onClose={() => setDialog(null)} onSaved={async (next) => {
          setDialog(null);
          await reloadCommunities();
          if (!next) router.push("/communities");
          else if (next.slug !== c.slug) router.push(`/c/${next.slug}`);
          else setC(next);
        }} />
      )}
    </div>
  );
}

function Members({ c, onClose }: { c: Community; onClose: () => void }) {
  const { say } = useApp();
  const [list, setList] = useState<Member[] | null>(null);
  const load = useCallback(async () => setList(await api<Member[]>(`/api/communities/${c.id}/members`)), [c.id]);
  useEffect(() => {
    load().catch((e) => say(e.message));
  }, [load, say]);
  const change = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      say((e as Error).message);
    }
  };
  return (
    <Modal title={`Members of ${c.name}`} onClose={onClose}>
      <div className="form">
        {c.canManage && c.slug !== "all-company" && (
          <PeoplePicker placeholder="Add someone" exclude={list?.map((m) => m.email) ?? []}
            onPick={(p) => void change(() => api(`/api/communities/${c.id}/members`, { method: "POST", json: { email: p.email } }))} />
        )}
        <ul className="people">
          {list?.map((m) => (
            <li key={m.email}>
              <Avatar person={m} size={30} />
              <span className="grow">{m.name}<span className="muted small"> {m.email}</span></span>
              {c.canManage && c.slug !== "all-company" ? (
                <>
                  <select value={m.role} onChange={(e) => void change(() => api(`/api/communities/${c.id}/members`, { method: "POST", json: { email: m.email, role: e.target.value } }))}>
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button className="linkbtn small" onClick={() => void change(() => api(`/api/communities/${c.id}/members?email=${encodeURIComponent(m.email)}`, { method: "DELETE" }))}>Remove</button>
                </>
              ) : (
                m.role === "admin" && <span className="muted small">Admin</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

type Channel = { id: number; name: string; url: string };

function SettingsDialog({ c, onClose, onSaved }: { c: Community; onClose: () => void; onSaved: (c: Community | null) => void }) {
  const { me } = useApp();
  const [v, setV] = useState({ name: c.name, description: c.description, privacy: c.privacy, color: c.color, chatUrl: c.chatUrl, chatName: c.chatName, siteUrl: c.siteUrl, official: c.official });
  const [channels, setChannels] = useState<Channel[]>([]);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    api<{ channels: Channel[] }>("/api/chat/channels").then((r) => setChannels(r.channels), () => {});
  }, []);
  const fixed = c.slug === "all-company";
  return (
    <Modal title="Community settings" onClose={onClose} wide>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        try {
          const { official, ...rest } = v;
          onSaved(await api<Community>(`/api/communities/${c.id}`, { method: "PATCH", json: me.admin ? { ...rest, official } : rest }));
        } catch (x) {
          setError((x as Error).message);
        }
      }}>
        <label><span>Name</span><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
        <label><span>Description</span><input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></label>
        {!fixed && (
          <label>
            <span>Who can see it</span>
            <select value={v.privacy} onChange={(e) => setV({ ...v, privacy: e.target.value as Community["privacy"] })}>
              <option value="public">Public: anyone can find, read and join it</option>
              <option value="private">Private: only members, added by an admin</option>
            </select>
          </label>
        )}
        <div className="swatches">
          {COLORS.map((col) => (
            <button key={col} type="button" aria-label={col} className={`swatch${v.color === col ? " on" : ""}`} style={{ background: COLOR_HEX[col] }} onClick={() => setV({ ...v, color: col })} />
          ))}
        </div>
        <label>
          <span>Chat channel</span>
          <select value={v.chatUrl} onChange={(e) => {
            const ch = channels.find((x) => x.url === e.target.value);
            setV({ ...v, chatUrl: e.target.value, chatName: ch?.name ?? "" });
          }}>
            <option value="">None</option>
            {v.chatUrl && !channels.some((x) => x.url === v.chatUrl) && <option value={v.chatUrl}>#{v.chatName || "linked channel"}</option>}
            {channels.map((ch) => <option key={ch.id} value={ch.url}>#{ch.name}</option>)}
          </select>
        </label>
        <label><span>Site (a page in Sites or any web address)</span><input value={v.siteUrl} placeholder="https://" onChange={(e) => setV({ ...v, siteUrl: e.target.value })} /></label>
        {me.admin && (
          <label className="check"><input type="checkbox" checked={v.official} onChange={(e) => setV({ ...v, official: e.target.checked })} /> Official community (shown first)</label>
        )}
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          {!fixed && <button type="button" className="btn danger" onClick={() => setConfirm(true)}>Delete community</button>}
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Save</button>
        </div>
      </form>
      {confirm && (
        <Confirm title={`Delete ${c.name}`} danger action="Delete" message="Every post and reply in it will be deleted for everyone." onClose={() => setConfirm(false)}
          onConfirm={async () => { await api(`/api/communities/${c.id}`, { method: "DELETE" }); onSaved(null); }} />
      )}
    </Modal>
  );
}
