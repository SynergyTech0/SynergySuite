"use client";
/** A record's comments, under it in Form view and in a card opened from a list view. */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Comment } from "@/lib/comments";

function when(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60 && d.getDate() === new Date().getDate()) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function Comments({ tableId, rowId, canEdit }: { tableId: string; rowId: string; canEdit: boolean }) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const base = `/api/tables/${tableId}/rows/${rowId}/comments`;

  useEffect(() => {
    setComments(null);
    setError("");
    api<{ comments: Comment[] }>(base)
      .then((d) => setComments(d.comments))
      .catch((e) => setError(e.message));
  }, [base]);

  async function post() {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      setComments((await api<{ comments: Comment[] }>(base, { body: { body: draft } })).comments);
      setDraft("");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Comment) {
    if (!confirm("Delete this comment?")) return;
    try {
      await api(`/api/comments/${c.id}`, { method: "DELETE" });
      setComments((cs) => cs?.filter((x) => x.id !== c.id) ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="comments">
      <h3>Comments{comments?.length ? ` (${comments.length})` : ""}</h3>
      {comments?.length === 0 && <p className="muted small">No comments yet.</p>}
      <ul>
        {comments?.map((c) => (
          <li key={c.id}>
            <div className="comment-head">
              <strong>{c.author}</strong> <span className="muted small">{when(c.createdAt)}</span>
              {c.canDelete && (
                <button aria-label="Delete comment" title="Delete comment" onClick={() => remove(c)}>
                  ✕
                </button>
              )}
            </div>
            <p>{c.body}</p>
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
      {canEdit && (
        <form
          className="comment-add"
          onSubmit={(e) => {
            e.preventDefault();
            void post();
          }}
        >
          <textarea
            aria-label="Add a comment"
            placeholder="Add a comment"
            rows={2}
            maxLength={4000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void post();
            }}
          />
          <button className="primary" type="submit" disabled={busy || !draft.trim()}>
            Post
          </button>
        </form>
      )}
    </section>
  );
}
