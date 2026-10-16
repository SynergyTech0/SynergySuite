"use client";

// Comments pane for Slides: threads anchored to a slide (and optionally an
// object on it), written by signed-in Synergy users through the suite's
// comment API. Replies, resolve/reopen, delete and @mentions of people who
// can see the deck.
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { MENTION, decodeAnchor, initials, type CommentThread } from "@/lib/slides/comments";
import type { Slide } from "@/lib/slides/model";

const PALETTE = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];
export function personColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function Avatar({ name, email, size = 22 }: { name: string; email: string; size?: number }) {
  return (
    <span
      title={`${name} <${email}>`}
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: personColor(email || name) }}
    >
      {initials(name || email)}
    </span>
  );
}

function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

/** Comment text with @mentions picked out. */
function Body({ text, me }: { text: string; me: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION)) {
    const at = m.index ?? 0;
    parts.push(text.slice(last, at));
    const mine = m[1].toLowerCase() === me.toLowerCase();
    parts.push(
      <span key={at} data-testid="comment-mention" className={`rounded px-0.5 font-medium ${mine ? "bg-amber-100 text-amber-800" : "bg-indigo-50 text-indigo-700"}`}>
        @{m[1]}
      </span>,
    );
    last = at + m[0].length;
  }
  parts.push(text.slice(last));
  return <p className="text-[13px] text-slate-700 whitespace-pre-wrap break-words">{parts}</p>;
}

/** A textarea that suggests people after "@". */
function Composer({ testId, postId, placeholder, people, onPost, onCancel, label }: {
  testId: string;
  postId: string;
  placeholder: string;
  people: string[];
  onPost: (body: string) => Promise<boolean>;
  onCancel: () => void;
  label: string;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const partial = /(^|\s)@([^\s@]*)$/.exec(text);
  const matches = partial ? people.filter((p) => p.toLowerCase().includes(partial[2].toLowerCase())).slice(0, 5) : [];
  const post = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    if (await onPost(text.trim())) setText("");
    setBusy(false);
  };
  return (
    <div className="relative">
      <textarea
        ref={ref}
        data-testid={testId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) post();
          if (e.key === "Escape") onCancel();
        }}
        placeholder={placeholder}
        rows={2}
        className="w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
      />
      {matches.length > 0 && (
        <div className="absolute left-0 right-0 z-10 rounded-md border border-slate-200 bg-white shadow-md text-xs" data-testid="mention-list">
          {matches.map((p) => (
            <button
              key={p}
              type="button"
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-indigo-50"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setText(text.replace(/@([^\s@]*)$/, `@${p} `))}
            >
              <Avatar name={p} email={p} size={18} /> {p}
            </button>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2 mt-1.5">
        <button onClick={onCancel} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1">Cancel</button>
        <button data-testid={postId} onClick={post} disabled={!text.trim() || busy} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded px-3 py-1 disabled:opacity-50">{label}</button>
      </div>
    </div>
  );
}

export default function CommentsPane({
  threads,
  slides,
  current,
  me,
  canComment,
  canDelete,
  draft,
  focusId,
  people,
  onPost,
  onReply,
  onResolve,
  onDelete,
  onCancelDraft,
  onNew,
  onGo,
  onClose,
}: {
  threads: CommentThread[];
  slides: Slide[];
  current: number;
  me: { name: string; email: string };
  canComment: boolean;
  canDelete: boolean;
  draft: { label: string } | null;
  focusId: string | null;
  people: string[];
  onPost: (body: string) => Promise<boolean>;
  onReply: (threadId: string, body: string) => Promise<boolean>;
  onResolve: (t: CommentThread) => void;
  onDelete: (threadId: string) => void;
  onCancelDraft: () => void;
  onNew: () => void;
  onGo: (slide: number, threadId: string) => void;
  onClose: () => void;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusId) return;
    listRef.current?.querySelector(`[data-thread-id="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [focusId]);

  const index = new Map(slides.map((s, i) => [s.id, i]));
  const rows = threads
    .map((t) => ({ t, a: decodeAnchor(t.quote) }))
    .filter((r) => r.a && (showResolved || !r.t.resolved))
    .map((r) => ({ ...r, slide: index.get(r.a!.slideId) ?? -1 }))
    .sort((p, q) => (p.slide === -1 ? 1e9 : p.slide) - (q.slide === -1 ? 1e9 : q.slide) || Number(p.t.created_ms) - Number(q.t.created_ms));
  const resolvedCount = threads.filter((t) => t.resolved && decodeAnchor(t.quote)).length;

  return (
    <aside className="w-80 shrink-0 border-l border-slate-200 bg-white flex flex-col min-h-0 no-print" data-testid="comments-pane">
      <div className="border-b border-slate-200 px-4 py-2.5 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-800">Comments</h2>
        {canComment && !draft && <button data-testid="comment-new" onClick={onNew} className="text-xs rounded bg-indigo-600 px-2 py-1 text-white hover:bg-indigo-700">+ New</button>}
        <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700 text-sm" aria-label="Close comments">✕</button>
      </div>
      {resolvedCount > 0 && (
        <label className="flex items-center gap-2 px-4 py-1.5 text-xs text-slate-500 border-b border-slate-100">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show {resolvedCount} resolved
        </label>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto" ref={listRef}>
        {draft && (
          <div className="p-3 border-b border-slate-100 bg-indigo-50/40" data-testid="comment-draft">
            <div className="flex items-center gap-2 mb-1.5">
              <Avatar name={me.name} email={me.email} />
              <span className="text-xs font-semibold text-slate-800">{me.name}</span>
              <span className="text-[11px] text-slate-500 truncate">on slide {current + 1}{draft.label ? ` · ${draft.label}` : ""}</span>
            </div>
            <Composer testId="comment-input" postId="comment-post" placeholder="Add a comment… (@ to mention someone)" people={people} onPost={onPost} onCancel={onCancelDraft} label="Comment" />
          </div>
        )}
        {rows.length === 0 && !draft && (
          <p className="text-xs text-slate-400 p-4 text-center">No comments yet.{canComment ? " Select an object (or nothing, for the whole slide) and click + New." : ""}</p>
        )}
        {rows.map(({ t, a, slide }, k) => (
          <Fragment key={t.id}>
            {(k === 0 || rows[k - 1].slide !== slide) && (
              <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{slide >= 0 ? `Slide ${slide + 1}` : "Deleted slides"}</div>
            )}
            <div
              data-testid="comment-thread"
              data-thread-id={t.id}
              className={`mx-2 mb-2 rounded-lg border p-3 ${focusId === t.id ? "border-indigo-400 ring-2 ring-indigo-100" : "border-slate-200"} ${t.resolved ? "opacity-60" : ""} ${slide === current ? "" : "bg-slate-50/60"}`}
              onClick={() => slide >= 0 && onGo(slide, t.id)}
            >
              {a?.label && <div className="text-[11px] text-slate-500 mb-1.5 line-clamp-2 border-l-2 border-amber-300 pl-2 italic">{a.label}</div>}
              <div className="space-y-2.5">
                {t.messages.map((m) => (
                  <div key={m.id} className="flex gap-2">
                    <Avatar name={m.author_name} email={m.author_email} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xs font-semibold text-slate-800" data-testid="comment-author">{m.author_name}</span>
                        <span className="text-[10px] text-slate-400">{ago(Number(m.created_ms))}</span>
                      </div>
                      <Body text={m.body} me={me.email} />
                    </div>
                  </div>
                ))}
              </div>
              {replyFor === t.id ? (
                <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                  <Composer
                    testId="comment-reply-input"
                    postId="comment-reply-post"
                    placeholder="Reply…"
                    people={people}
                    label="Reply"
                    onCancel={() => setReplyFor(null)}
                    onPost={async (body) => {
                      const ok = await onReply(t.id, body);
                      if (ok) setReplyFor(null);
                      return ok;
                    }}
                  />
                </div>
              ) : (
                canComment && (
                  <div className="flex items-center gap-3 mt-2 text-[11px]" onClick={(e) => e.stopPropagation()}>
                    <button data-testid="comment-reply" onClick={() => setReplyFor(t.id)} className="text-indigo-600 hover:underline">Reply</button>
                    <button data-testid="comment-resolve" onClick={() => onResolve(t)} className="text-slate-500 hover:text-emerald-600">{t.resolved ? "Reopen" : "Resolve"}</button>
                    {canDelete && <button data-testid="comment-delete" onClick={() => onDelete(t.id)} className="text-slate-400 hover:text-red-500 ml-auto">Delete</button>}
                  </div>
                )
              )}
            </div>
          </Fragment>
        ))}
      </div>
    </aside>
  );
}
