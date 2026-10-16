"use client";
import {
  Award, Bookmark, BookmarkCheck, CheckCircle2, CircleHelp, Lock, Megaphone, MessageSquare, MoreHorizontal, Newspaper,
  Pencil, Pin, Share2, Sparkles, Trash2, Link2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { Comment, Post, Reaction } from "@/lib/types";
import { BADGES } from "@/lib/types";
import { Avatar, RichText } from "./bits";
import { BADGE_EMOJI, COLOR_HEX, REACTION_EMOJI, ago, api, personHref } from "./client";
import { Confirm } from "./Modal";
import { ShareToChat } from "./ShareToChat";

type Ctx = { ai: boolean; say: (t: string) => void };

export function PostCard({ post: initial, full, ctx, onRemoved }: {
  post: Post; full?: boolean; ctx: Ctx; onRemoved?: (id: string) => void;
}) {
  const [post, setPost] = useState(initial);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<React.ReactNode>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [replying, setReplying] = useState(full ?? false);

  const reload = async () => setPost(await api<Post>(`/api/posts/${post.id}`));
  const act = async (fn: () => Promise<unknown>, after?: string) => {
    try {
      await fn();
      if (after) ctx.say(after);
    } catch (e) {
      ctx.say((e as Error).message);
    }
  };
  const close = () => setDialog(null);

  const kindLabel = {
    question: { icon: <CircleHelp size={14} />, text: post.bestAnswer ? "Answered question" : "Question" },
    praise: { icon: <Award size={14} />, text: "Praise" },
    poll: { icon: <span>📊</span>, text: "Poll" },
    article: { icon: <Newspaper size={14} />, text: "Article" },
    discussion: null,
  }[post.kind];

  return (
    <article className={`post${post.announcement ? " announce" : ""}`}>
      {(post.announcement || post.pinned) && (
        <div className="postflag">
          {post.announcement && <span><Megaphone size={14} /> Announcement</span>}
          {post.pinned && <span><Pin size={14} /> Pinned</span>}
        </div>
      )}
      <header className="posthead">
        <Avatar person={post.author} />
        <div className="grow">
          <div>
            <Link className="name" href={personHref(post.author.email)}>{post.author.name}</Link>
            {post.community && (
              <>
                <span className="muted"> in </span>
                <Link className="community" href={`/c/${post.community.slug}`} style={{ color: COLOR_HEX[post.community.color] }}>
                  {post.community.privacy === "private" && <Lock size={12} />} {post.community.name}
                </Link>
              </>
            )}
          </div>
          <div className="muted small">
            <Link href={`/posts/${post.id}`} className="muted">{ago(post.createdAt)}</Link>
            {post.editedAt && " · edited"}
            {kindLabel && <span className="kind">{kindLabel.icon} {kindLabel.text}</span>}
          </div>
        </div>
        <div className="menuwrap">
          <button className="iconbtn" aria-label="More" onClick={() => setMenu(!menu)}><MoreHorizontal size={18} /></button>
          {menu && (
            <div className="menu right" onMouseLeave={() => setMenu(false)}>
              <button onClick={() => { setMenu(false); void act(async () => { await api(`/api/posts/${post.id}/save`, { method: "POST", json: { on: !post.saved } }); await reload(); }, post.saved ? "Removed from saved" : "Saved"); }}>
                {post.saved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />} {post.saved ? "Unsave" : "Save"}
              </button>
              <button onClick={() => { setMenu(false); void act(() => navigator.clipboard.writeText(`${location.origin}/posts/${post.id}`), "Link copied"); }}>
                <Link2 size={16} /> Copy link
              </button>
              <button onClick={() => { setMenu(false); setDialog(<ShareToChat postId={post.id} onClose={close} say={ctx.say} />); }}>
                <Share2 size={16} /> Share to Chat
              </button>
              {post.can.edit && <button onClick={() => { setMenu(false); setEditing(true); }}><Pencil size={16} /> Edit</button>}
              {post.can.moderate && (
                <>
                  <button onClick={() => { setMenu(false); void act(async () => { await api(`/api/posts/${post.id}`, { method: "PATCH", json: { pinned: !post.pinned } }); await reload(); }); }}>
                    <Pin size={16} /> {post.pinned ? "Unpin" : "Pin to the community"}
                  </button>
                  <button onClick={() => { setMenu(false); void act(async () => { await api(`/api/posts/${post.id}`, { method: "PATCH", json: { announcement: !post.announcement } }); await reload(); }); }}>
                    <Megaphone size={16} /> {post.announcement ? "Not an announcement" : "Make an announcement"}
                  </button>
                </>
              )}
              {post.can.delete && (
                <>
                  <hr />
                  <button className="dangertext" onClick={() => {
                    setMenu(false);
                    setDialog(<Confirm title="Delete post" danger action="Delete" message="The post and its replies will be deleted." onClose={close}
                      onConfirm={async () => { await api(`/api/posts/${post.id}`, { method: "DELETE" }); onRemoved?.(post.id); ctx.say("Post deleted"); }} />);
                  }}>
                    <Trash2 size={16} /> Delete
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {post.kind === "praise" && (
        <div className="praise">
          <span className="badge">{BADGE_EMOJI[post.badge ?? "thank-you"]}</span>
          <div>
            <b>{BADGES[post.badge ?? "thank-you"]}</b>
            <div>
              {post.praised.map((p, i) => (
                <span key={p.email}>{i > 0 && ", "}<Link href={personHref(p.email)}>{p.name}</Link></span>
              ))}
            </div>
          </div>
        </div>
      )}

      {editing ? (
        <EditPost post={post} onDone={async (changed) => { setEditing(false); if (changed) await reload(); }} say={ctx.say} />
      ) : (
        <div className="postbody">
          {post.title && (post.kind === "article" && !full ? <h2><Link href={`/posts/${post.id}`}>{post.title}</Link></h2> : <h2>{post.title}</h2>)}
          {post.body && <Clamp full={full || post.kind !== "article"}><RichText text={post.body} people={post.mentions} /></Clamp>}
        </div>
      )}

      {post.poll && <PollView post={post} onChange={setPost} say={ctx.say} />}

      {summary !== null && (
        <div className="aibox"><Sparkles size={15} /><div className="grow">{summary ? <RichText text={summary} /> : <span className="muted">Summarizing…</span>}</div></div>
      )}

      <div className="postbar">
        <Reactions targetId={post.id} counts={post.reactions} mine={post.myReaction} onChange={reload} say={ctx.say} />
        <button className="btn ghost small" onClick={() => setReplying(true)}><MessageSquare size={15} /> Reply</button>
        {post.commentCount > 0 && !full && <Link className="muted small" href={`/posts/${post.id}`}>{post.commentCount} {post.commentCount === 1 ? "reply" : "replies"}</Link>}
        <span className="grow" />
        {ctx.ai && post.commentCount > 2 && summary === null && (
          <button className="btn ghost small" onClick={() => {
            setSummary("");
            api<{ text: string }>("/api/ai", { method: "POST", json: { action: "summarize", postId: post.id } })
              .then((r) => setSummary(r.text), (e) => { setSummary(null); ctx.say(e.message); });
          }}>
            <Sparkles size={15} /> Summarize
          </button>
        )}
      </div>

      <Comments post={post} full={!!full} replying={replying} onChange={reload} ctx={ctx} />
      {dialog}
    </article>
  );
}

function Clamp({ full, children }: { full: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(full);
  return (
    <div className={open ? "" : "clamp"}>
      {children}
      {!open && <button className="linkbtn" onClick={() => setOpen(true)}>Read more</button>}
    </div>
  );
}

function EditPost({ post, onDone, say }: { post: Post; onDone: (changed: boolean) => void; say: (t: string) => void }) {
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.body);
  return (
    <form className="editpost" onSubmit={async (e) => {
      e.preventDefault();
      try {
        await api(`/api/posts/${post.id}`, { method: "PATCH", json: { title, body } });
        onDone(true);
      } catch (x) {
        say((x as Error).message);
      }
    }}>
      {(post.kind === "article" || post.title) && <input className="titlefield" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />}
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
      <div className="actions">
        <button type="button" className="btn" onClick={() => onDone(false)}>Cancel</button>
        <button className="btn primary">Save</button>
      </div>
    </form>
  );
}

function PollView({ post, onChange, say }: { post: Post; onChange: (p: Post) => void; say: (t: string) => void }) {
  const poll = post.poll!;
  const voted = poll.myVote !== null;
  const choose = async (optionId: string | null) => {
    try {
      onChange(await api<Post>(`/api/posts/${post.id}/vote`, { method: "POST", json: { optionId } }));
    } catch (e) {
      say((e as Error).message);
    }
  };
  return (
    <div className="poll">
      {poll.options.map((o) => {
        const pct = poll.total ? Math.round((o.votes / poll.total) * 100) : 0;
        return voted ? (
          <button key={o.id} className={`pollrow result${poll.myVote === o.id ? " mine" : ""}`} onClick={() => void choose(o.id)}>
            <span className="fill" style={{ width: `${pct}%` }} />
            <span className="grow">{o.label} {poll.myVote === o.id && <CheckCircle2 size={14} />}</span>
            <span>{pct}%</span>
          </button>
        ) : (
          <button key={o.id} className="pollrow" onClick={() => void choose(o.id)}>{o.label}</button>
        );
      })}
      <div className="muted small">
        {poll.total} {poll.total === 1 ? "vote" : "votes"}
        {voted && <> · <button className="linkbtn" onClick={() => void choose(null)}>Take back my vote</button></>}
      </div>
    </div>
  );
}

export function Reactions({ targetId, counts, mine, onChange, say, small }: {
  targetId: string; counts: Partial<Record<Reaction, number>>; mine: Reaction | null; onChange: () => Promise<void> | void;
  say: (t: string) => void; small?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const set = async (kind: Reaction | null) => {
    setOpen(false);
    try {
      await api("/api/reactions", { method: "POST", json: { targetId, kind } });
      await onChange();
    } catch (e) {
      say((e as Error).message);
    }
  };
  const total = Object.values(counts).reduce((s, n) => s + (n ?? 0), 0);
  const top = (Object.entries(counts) as [Reaction, number][]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return (
    <div className="reactions" onMouseLeave={() => setOpen(false)}>
      <button
        className={`btn ghost ${small ? "tiny" : "small"}${mine ? " on" : ""}`}
        onClick={() => void set(mine ? null : "like")}
        onMouseEnter={() => setOpen(true)}
        onContextMenu={(e) => { e.preventDefault(); setOpen(true); }}
      >
        <span>{mine ? REACTION_EMOJI[mine].emoji : "👍"}</span> {mine ? REACTION_EMOJI[mine].label : "Like"}
      </button>
      {open && (
        <div className="reactpick" role="menu">
          {Object.entries(REACTION_EMOJI).map(([k, v]) => (
            <button key={k} title={v.label} aria-label={v.label} className={mine === k ? "on" : ""} onClick={() => void set(k as Reaction)}>{v.emoji}</button>
          ))}
        </div>
      )}
      {total > 0 && (
        <span className="rcount" title={top.map(([k, n]) => `${REACTION_EMOJI[k].label} ${n}`).join(", ")}>
          {top.map(([k]) => REACTION_EMOJI[k].emoji).join("")} {total}
        </span>
      )}
    </div>
  );
}

function Comments({ post, full, replying, onChange, ctx }: { post: Post; full: boolean; replying: boolean; onChange: () => Promise<void>; ctx: Ctx }) {
  const tops = post.comments.filter((c) => !c.parentId || !post.comments.some((p) => p.id === c.parentId));
  const repliesTo = (id: string) => post.comments.filter((c) => c.parentId === id);
  const best = post.comments.find((c) => c.id === post.bestAnswer);
  if (!post.comments.length && !replying) return null;
  return (
    <div className="comments">
      {!full && post.commentCount > post.comments.length && (
        <Link className="linkbtn small" href={`/posts/${post.id}`}>See all {post.commentCount} replies</Link>
      )}
      {best && !full && <div className="muted small"><CheckCircle2 size={13} /> Best answer by {best.author.name}</div>}
      {tops.map((c) => (
        <div key={c.id}>
          <CommentRow c={c} post={post} onChange={onChange} ctx={ctx} />
          <div className="subreplies">
            {repliesTo(c.id).map((r) => <CommentRow key={r.id} c={r} post={post} onChange={onChange} ctx={ctx} />)}
          </div>
        </div>
      ))}
      {replying && <ReplyBox postId={post.id} onSent={onChange} say={ctx.say} />}
    </div>
  );
}

function CommentRow({ c, post, onChange, ctx }: { c: Comment; post: Post; onChange: () => Promise<void>; ctx: Ctx }) {
  const [editing, setEditing] = useState(false);
  const [reply, setReply] = useState(false);
  const [body, setBody] = useState(c.body);
  const [confirm, setConfirm] = useState(false);
  const isBest = post.bestAnswer === c.id;
  return (
    <div className={`comment${isBest ? " best" : ""}`}>
      <Avatar person={c.author} size={28} />
      <div className="grow">
        <div className="bubble">
          <div className="small">
            <Link className="name" href={personHref(c.author.email)}>{c.author.name}</Link>
            <span className="muted"> · {ago(c.createdAt)}{c.editedAt && " · edited"}</span>
            {isBest && <span className="bestlabel"><CheckCircle2 size={13} /> Best answer</span>}
          </div>
          {editing ? (
            <form onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api(`/api/comments/${c.id}`, { method: "PATCH", json: { body } });
                setEditing(false);
                await onChange();
              } catch (x) {
                ctx.say((x as Error).message);
              }
            }}>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} autoFocus />
              <div className="actions"><button type="button" className="btn small" onClick={() => setEditing(false)}>Cancel</button><button className="btn small primary">Save</button></div>
            </form>
          ) : (
            <RichText text={c.body} people={c.mentions} />
          )}
        </div>
        <div className="commentbar">
          <Reactions small targetId={c.id} counts={c.reactions} mine={c.myReaction} onChange={onChange} say={ctx.say} />
          <button className="linkbtn small" onClick={() => setReply(!reply)}>Reply</button>
          {post.can.markAnswer && (
            <button className="linkbtn small" onClick={async () => {
              try {
                await api(`/api/posts/${post.id}/answer`, { method: "POST", json: { commentId: isBest ? null : c.id } });
                await onChange();
              } catch (x) {
                ctx.say((x as Error).message);
              }
            }}>{isBest ? "Not the best answer" : "Best answer"}</button>
          )}
          {c.canEdit && <button className="linkbtn small" onClick={() => setEditing(true)}>Edit</button>}
          {c.canDelete && <button className="linkbtn small" onClick={() => setConfirm(true)}>Delete</button>}
        </div>
        {reply && <ReplyBox postId={post.id} parentId={c.id} onSent={async () => { setReply(false); await onChange(); }} say={ctx.say} autoFocus />}
      </div>
      {confirm && (
        <Confirm title="Delete reply" danger action="Delete" message="The reply and any replies to it will be deleted." onClose={() => setConfirm(false)}
          onConfirm={async () => { await api(`/api/comments/${c.id}`, { method: "DELETE" }); await onChange(); }} />
      )}
    </div>
  );
}

function ReplyBox({ postId, parentId, onSent, say, autoFocus }: {
  postId: string; parentId?: string; onSent: () => Promise<void>; say: (t: string) => void; autoFocus?: boolean;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api(`/api/posts/${postId}/comments`, { method: "POST", json: { body, parentId } });
      setBody("");
      await onSent();
    } catch (e) {
      say((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="replybox">
      <textarea
        value={body}
        rows={1}
        autoFocus={autoFocus}
        placeholder={parentId ? "Write a reply" : "Reply to the post"}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
        }}
      />
      <button className="btn primary small" disabled={busy || !body.trim()} onClick={() => void send()}>Reply</button>
    </div>
  );
}

