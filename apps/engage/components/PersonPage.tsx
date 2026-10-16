"use client";
import { Pencil } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Person, Post } from "@/lib/types";
import { Avatar } from "./bits";
import { api } from "./client";
import { Composer } from "./Composer";
import { Feed } from "./Feed";
import { Modal } from "./Modal";
import { useApp } from "./Shell";

/** Someone's profile and storyline: what they posted, to their storyline or to communities you can see. */
export function PersonPage({ email }: { email: string }) {
  const { me, say } = useApp();
  const [p, setP] = useState<Person | null>(null);
  const [editing, setEditing] = useState(false);
  const [posted, setPosted] = useState<Post | null>(null);
  const self = email.toLowerCase() === me.email;

  const load = useCallback(async () => setP(await api<Person>(`/api/people/${encodeURIComponent(email)}`)), [email]);
  useEffect(() => {
    load().catch((e) => say(e.message));
  }, [load, say]);

  if (!p) return <p className="muted center pad">Loading…</p>;
  return (
    <div className="column">
      <div className="profile">
        <Avatar person={p} size={72} />
        <div className="grow">
          <h1>{p.name}</h1>
          <p className="muted">{[p.title, p.department].filter(Boolean).join(" · ") || p.email}</p>
          {p.about && <p>{p.about}</p>}
          <p className="muted small">
            {p.followers} {p.followers === 1 ? "follower" : "followers"} · following {p.following} · {p.communities} {p.communities === 1 ? "community" : "communities"} · {p.posts} {p.posts === 1 ? "post" : "posts"}
          </p>
        </div>
        {self ? (
          <button className="btn small" onClick={() => setEditing(true)}><Pencil size={14} /> Edit profile</button>
        ) : (
          <button className={`btn small${p.followed ? "" : " primary"}`} onClick={async () => {
            try {
              await api(`/api/people/${encodeURIComponent(p.email)}/follow`, { method: "POST", json: { on: !p.followed } });
              await load();
            } catch (e) { say((e as Error).message); }
          }}>{p.followed ? "Following" : "Follow"}</button>
        )}
      </div>
      {self && <Composer me={me} communities={[]} onPosted={setPosted} say={say} />}
      <Feed params={{ view: "person", person: p.email }} prepend={posted} empty={<p>{self ? "Your storyline is empty. Share something." : `${p.name} hasn't posted anything you can see.`}</p>} />
      {editing && (
        <Modal title="Your profile" onClose={() => setEditing(false)}>
          <form className="form" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              setP(await api<Person>(`/api/people/${encodeURIComponent(me.email)}`, { method: "PATCH", json: Object.fromEntries(f) }));
              setEditing(false);
            } catch (x) { say((x as Error).message); }
          }}>
            <label><span>Job title</span><input name="title" defaultValue={p.title} /></label>
            <label><span>Department</span><input name="department" defaultValue={p.department} /></label>
            <label><span>About you</span><textarea name="about" defaultValue={p.about} rows={4} /></label>
            <div className="actions"><button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button><button className="btn primary">Save</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
