"use client";
import { BadgeCheck, Lock, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Community } from "@/lib/types";
import { COLORS } from "@/lib/types";
import { COLOR_HEX, ago, api } from "./client";
import { Modal } from "./Modal";
import { useApp } from "./Shell";

export function CommunitiesPage() {
  const { say, reloadCommunities } = useApp();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [list, setList] = useState<Community[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      api<Community[]>(`/api/communities?q=${encodeURIComponent(query)}`).then(setList, (e) => say(e.message));
    }, query ? 200 : 0);
    return () => window.clearTimeout(t);
  }, [query, say]);

  return (
    <div className="column">
      <div className="head">
        <div className="titlerow"><h1>Communities</h1><span className="grow" /><button className="btn primary small" onClick={() => setCreating(true)}><Plus size={15} /> New community</button></div>
        <p className="muted">Groups for teams, projects, interests and places. Public ones are open to everyone.</p>
      </div>
      <label className="search wide"><Search size={16} /><input placeholder="Find a community" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <div className="cgrid">
        {list?.map((c) => (
          <Link key={c.id} className="ccard" href={`/c/${c.slug}`}>
            <span className="cstripe" style={{ background: COLOR_HEX[c.color] }} />
            <span className="ccardbody">
              <b>{c.name} {c.official && <BadgeCheck size={14} color={COLOR_HEX.blue} />} {c.privacy === "private" && <Lock size={13} />}</b>
              <span className="muted small">{c.description || "No description yet."}</span>
              <span className="muted small">
                {c.members} {c.members === 1 ? "member" : "members"} · {c.posts} {c.posts === 1 ? "post" : "posts"}
                {c.lastActivity && ` · active ${ago(c.lastActivity)}`}{c.myRole && " · joined"}
              </span>
            </span>
          </Link>
        ))}
        {list?.length === 0 && <p className="muted">No communities match.</p>}
      </div>
      {creating && (
        <NewCommunity onClose={() => setCreating(false)} onMade={async (c) => {
          await reloadCommunities();
          router.push(`/c/${c.slug}`);
        }} />
      )}
    </div>
  );
}

function NewCommunity({ onClose, onMade }: { onClose: () => void; onMade: (c: Community) => void }) {
  const [v, setV] = useState({ name: "", description: "", privacy: "public", color: "blue" });
  const [error, setError] = useState("");
  return (
    <Modal title="New community" onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        try {
          onMade(await api<Community>("/api/communities", { method: "POST", json: v }));
        } catch (x) {
          setError((x as Error).message);
        }
      }}>
        <label><span>Name</span><input autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
        <label><span>What it&apos;s for</span><input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></label>
        <label>
          <span>Who can see it</span>
          <select value={v.privacy} onChange={(e) => setV({ ...v, privacy: e.target.value })}>
            <option value="public">Public: anyone can find, read and join it</option>
            <option value="private">Private: only members you add</option>
          </select>
        </label>
        <div className="swatches">
          {COLORS.map((col) => (
            <button key={col} type="button" aria-label={col} className={`swatch${v.color === col ? " on" : ""}`} style={{ background: COLOR_HEX[col] }} onClick={() => setV({ ...v, color: col })} />
          ))}
        </div>
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Create</button>
        </div>
      </form>
    </Modal>
  );
}
