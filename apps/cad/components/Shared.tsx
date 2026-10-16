"use client";
import { useEffect, useState } from "react";
import { MAX_AUTHOR, MAX_COMMENT, type SharedView } from "@/lib/share";
import type { Comment, Drawing } from "@/lib/store";
import { Editor } from "./Editor";
import { Modeler } from "./Modeler";

const GUEST_NAME = "synergy-cad-guest-name";

function when(at: string): string {
  return new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** A shared file in its viewer, view only, beside the review comments. */
export function Shared({ token, initial, signedInAs }: { token: string; initial: SharedView; signedInAs: string | null }) {
  const [view, setView] = useState(initial);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileUrl = `/api/shared/${token}/file`;
  // The viewers only read the name from this; the id and dates stay private to the owner.
  const file: Drawing = { id: "", name: view.name, size: view.size, created: view.modified, modified: view.modified };

  useEffect(() => {
    try {
      setName(localStorage.getItem(GUEST_NAME) ?? "");
    } catch {}
    // Pick up comments others leave while this is open.
    const timer = setInterval(async () => {
      const res = await fetch(`/api/shared/${token}`).catch(() => null);
      if (res?.ok) setView((await res.json()) as SharedView);
    }, 30_000);
    return () => clearInterval(timer);
  }, [token]);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      if (!signedInAs) localStorage.setItem(GUEST_NAME, name.trim());
    } catch {}
    const res = await fetch(`/api/shared/${token}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, name }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError((await res?.json().catch(() => null))?.error ?? "Couldn't post your comment. Try again.");
    const { comment } = (await res.json()) as { comment: Comment };
    setView((v) => ({ ...v, comments: [...v.comments.filter((c) => c.id !== comment.id), comment] }));
    setText("");
  }

  async function remove(c: Comment) {
    const res = await fetch(`/api/shared/${token}/comments?id=${c.id}`, { method: "DELETE" });
    if (res.ok) setView((v) => ({ ...v, comments: v.comments.filter((x) => x.id !== c.id) }));
  }

  return (
    <div className="shared">
      {view.editor === "edit" ? (
        <Editor file={file} fileUrl={fileUrl} readOnly />
      ) : view.editor === "model" ? (
        <Modeler file={file} fileUrl={fileUrl} readOnly />
      ) : (
        <main className="download">
          <p>
            <strong>{view.name}</strong> was shared with you.
          </p>
          <a className="button primary" href={fileUrl}>Download</a>
        </main>
      )}
      <aside className="review">
        <header>
          <h2>Comments</h2>
          <a href={fileUrl} title={`Download ${view.name}`}>Download</a>
        </header>
        <ol>
          {view.comments.length === 0 && <li className="none">No comments yet.</li>}
          {view.comments.map((c) => (
            <li key={c.id}>
              <div className="who">
                <strong>{c.author}</strong>
                {c.guest && <span className="guest">guest</span>}
                <time dateTime={c.at}>{when(c.at)}</time>
                {view.owner && (
                  <button aria-label={`Remove the comment from ${c.author}`} title="Remove" onClick={() => void remove(c)}>
                    ✕
                  </button>
                )}
              </div>
              <p>{c.text}</p>
            </li>
          ))}
        </ol>
        <form onSubmit={post}>
          {signedInAs ? (
            <span className="as">Commenting as {signedInAs}</span>
          ) : (
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_AUTHOR} placeholder="Your name" aria-label="Your name" />
          )}
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_COMMENT} rows={3} placeholder="Add a comment" aria-label="Comment" />
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={busy || !text.trim()}>{busy ? "Posting…" : "Comment"}</button>
        </form>
      </aside>
    </div>
  );
}
