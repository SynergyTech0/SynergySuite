"use client";
import { AtSign, Award, BarChart3, CircleHelp, MessageSquare, Newspaper, Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import type { Community, PersonRef, Post, PostKind } from "@/lib/types";
import { BADGES } from "@/lib/types";
import { Avatar, PeoplePicker } from "./bits";
import { BADGE_EMOJI } from "./client";
import { api } from "./client";

const TABS: { kind: PostKind; label: string; icon: React.ReactNode }[] = [
  { kind: "discussion", label: "Discussion", icon: <MessageSquare size={15} /> },
  { kind: "question", label: "Question", icon: <CircleHelp size={15} /> },
  { kind: "praise", label: "Praise", icon: <Award size={15} /> },
  { kind: "poll", label: "Poll", icon: <BarChart3 size={15} /> },
  { kind: "article", label: "Article", icon: <Newspaper size={15} /> },
];

/**
 * Writes a post. `communities` are where it can go (plus the author's storyline unless
 * `fixed` pins it to one community).
 */
export function Composer({ me, communities, fixed, onPosted, say }: {
  me: PersonRef; communities: Community[]; fixed?: Community; onPosted: (p: Post) => void; say: (t: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<PostKind>("discussion");
  const [where, setWhere] = useState(fixed?.id ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [praised, setPraised] = useState<PersonRef[]>([]);
  const [badge, setBadge] = useState("thank-you");
  const [options, setOptions] = useState(["", ""]);
  const [announce, setAnnounce] = useState(false);
  const [mention, setMention] = useState(false);
  const [busy, setBusy] = useState(false);
  const text = useRef<HTMLTextAreaElement>(null);

  const target = fixed ?? communities.find((c) => c.id === where);
  const reset = () => {
    setTitle(""); setBody(""); setPraised([]); setOptions(["", ""]); setAnnounce(false); setKind("discussion"); setOpen(false); setMention(false);
  };

  const insertMention = (p: PersonRef) => {
    const el = text.current;
    const at = el?.selectionStart ?? body.length;
    const before = body.slice(0, at);
    const pad = before && !/\s$/.test(before) ? " " : "";
    setBody(`${before}${pad}@${p.email} ${body.slice(at)}`);
    setMention(false);
    requestAnimationFrame(() => el?.focus());
  };

  const submit = async () => {
    setBusy(true);
    try {
      const post = await api<Post>("/api/posts", {
        method: "POST",
        json: {
          communityId: target?.id ?? null, kind, title, body, announcement: announce,
          praised: praised.map((p) => p.email), badge, options: options.filter((o) => o.trim()),
        },
      });
      onPosted(post);
      reset();
    } catch (e) {
      say((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="composer closed">
        <Avatar person={me} />
        <button className="fakeinput" onClick={() => setOpen(true)}>
          {fixed ? `Start a conversation in ${fixed.name}` : "Share something with your colleagues"}
        </button>
        <button className="iconbtn" title="Praise someone" onClick={() => { setKind("praise"); setOpen(true); }}><Award size={18} /></button>
        <button className="iconbtn" title="Ask a question" onClick={() => { setKind("question"); setOpen(true); }}><CircleHelp size={18} /></button>
        <button className="iconbtn" title="Start a poll" onClick={() => { setKind("poll"); setOpen(true); }}><BarChart3 size={18} /></button>
      </div>
    );
  }

  return (
    <div className="composer">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.kind} role="tab" aria-selected={kind === t.kind} className={kind === t.kind ? "on" : ""} onClick={() => setKind(t.kind)}>
            {t.icon} {t.label}
          </button>
        ))}
        <span className="grow" />
        <button className="iconbtn" aria-label="Close" onClick={reset}><X size={18} /></button>
      </div>

      {!fixed && (
        <label className="where">
          <span className="muted small">Post to</span>
          <select value={where} onChange={(e) => { setWhere(e.target.value); setAnnounce(false); }}>
            <option value="">Your storyline (everyone can see it)</option>
            {communities.filter((c) => c.myRole).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}

      {kind === "praise" && (
        <div className="praisepick">
          <div className="chips">
            {praised.map((p) => (
              <span className="chip" key={p.email}>
                <Avatar person={p} size={20} /> {p.name}
                <button className="iconbtn small" aria-label={`Remove ${p.name}`} onClick={() => setPraised(praised.filter((x) => x.email !== p.email))}><X size={12} /></button>
              </span>
            ))}
          </div>
          <PeoplePicker placeholder="Who are you praising?" exclude={[me.email, ...praised.map((p) => p.email)]} onPick={(p) => setPraised([...praised, p])} />
          <div className="badges">
            {Object.entries(BADGES).map(([k, label]) => (
              <button key={k} type="button" className={`badgebtn${badge === k ? " on" : ""}`} onClick={() => setBadge(k)}>
                <span>{BADGE_EMOJI[k]}</span> {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {(kind === "article" || kind === "question") && (
        <input className="titlefield" value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder={kind === "article" ? "Title" : "Your question in one line"} />
      )}

      <textarea
        ref={text}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={kind === "article" ? 10 : 4}
        autoFocus={kind !== "praise"}
        placeholder={
          kind === "question" ? "Add details (optional)" :
          kind === "poll" ? "Ask a question" :
          kind === "praise" ? "Tell everyone what they did" :
          kind === "article" ? "Write your article" : "Share an update, an idea or a link. Use #topics to tag it."
        }
      />

      {kind === "poll" && (
        <div className="polledit">
          {options.map((o, i) => (
            <div key={i} className="pollopt">
              <input value={o} placeholder={`Choice ${i + 1}`} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} />
              {options.length > 2 && <button className="iconbtn small" aria-label="Remove choice" onClick={() => setOptions(options.filter((_, j) => j !== i))}><X size={14} /></button>}
            </div>
          ))}
          {options.length < 10 && <button className="linkbtn" onClick={() => setOptions([...options, ""])}><Plus size={14} /> Add a choice</button>}
        </div>
      )}

      <div className="composerfoot">
        <div className="menuwrap">
          <button className="btn ghost small" onClick={() => setMention(!mention)}><AtSign size={15} /> Mention</button>
          {mention && <div className="menu pickpanel"><PeoplePicker autoFocus onPick={insertMention} placeholder="Find someone to mention" /></div>}
        </div>
        {target?.canManage && (
          <label className="check"><input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} /> Announcement</label>
        )}
        <span className="grow" />
        <button className="btn" onClick={reset}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={() => void submit()}>Post</button>
      </div>
    </div>
  );
}
