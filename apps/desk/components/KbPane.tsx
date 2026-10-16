"use client";
import { ArrowLeft, BookOpen, ExternalLink, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { renderMarkdown } from "@/lib/markdown";
import type { Article } from "@/lib/types";
import { Confirm } from "./Modal";
import { api, when } from "./client";

export function KbList({ articles, pick, onPick }: { articles: Article[] | null; pick: number | "new" | null; onPick: (p: number | "new") => void }) {
  return (
    <section className="listpane">
      <div className="listhead">
        <div className="titlerow">
          <h1 className="grow">Knowledge base</h1>
          <button className="btn small" onClick={() => onPick("new")}><Plus size={15} /> New article</button>
        </div>
        <p className="muted small hint">Published articles appear in the public <a href="/kb" target="_blank" rel="noopener">help center</a>; no sign-in needed.</p>
      </div>
      <div className="listbody">
        {!articles ? <p className="muted pad">Loading…</p> : articles.length ? (
          <ul className="tlist">
            {articles.map((a) => (
              <li key={a.id}>
                <button className={`trow${pick === a.id ? " sel" : ""}`} onClick={() => onPick(a.id)}>
                  <div className="trowtop">
                    <span className="tfrom">{a.title}</span>
                    <span className="twhen">{when(a.updatedAt)}</span>
                  </div>
                  <div className="tmeta">
                    <span className="mono">/kb/{a.slug}</span>
                    <span className={`st ${a.published ? "st-solved" : "st-closed"}`}>{a.published ? "published" : "draft"}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty grow"><BookOpen size={40} strokeWidth={1.2} /><p>No articles yet.</p></div>
        )}
      </div>
    </section>
  );
}

export function KbPane({ item, open, onBack, onSaved }: {
  item: Article | null; open: boolean; onBack: () => void; onSaved: (a: Article | null, verb: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [body, setBody] = useState(item?.body ?? "");
  const [published, setPublished] = useState(item?.published ?? false);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  if (!open) return <div className="empty"><BookOpen size={40} strokeWidth={1.2} /><p>Pick an article to edit it, or write a new one.</p></div>;

  const save = async () => {
    setError("");
    try {
      const json = { title, body, published };
      const a = item
        ? await api<Article>(`/api/kb/${item.id}`, { method: "PATCH", json })
        : await api<Article>("/api/kb", { method: "POST", json });
      await onSaved(a, a.published ? "Article saved and published" : "Draft saved");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="editor">
      <div className="editorhead">
        <button className="iconbtn back" aria-label="Back" onClick={onBack}><ArrowLeft size={18} /></button>
        <h2 className="grow">{item ? "Edit article" : "New article"}</h2>
        {item?.published && (
          <a className="btn ghost" href={`/kb/${item.slug}`} target="_blank" rel="noopener"><ExternalLink size={16} /> View</a>
        )}
        {item && (
          <button className="btn ghost" onClick={() => setAsking(true)}><Trash2 size={16} /> Delete</button>
        )}
        <button className="btn primary" disabled={!title.trim()} onClick={() => void save()}>Save</button>
      </div>
      <div className="form editorbody">
        <label><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!item} placeholder="e.g. How do I reset my password?" /></label>
        <div className="ctabs flat" role="tablist">
          <button role="tab" aria-selected={tab === "write"} className={tab === "write" ? "on" : ""} onClick={() => setTab("write")}>Write</button>
          <button role="tab" aria-selected={tab === "preview"} className={tab === "preview" ? "on" : ""} onClick={() => setTab("preview")}>Preview</button>
        </div>
        {tab === "write" ? (
          <textarea className="kbsource" rows={18} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Article text"
            placeholder={"Write the article. # Heading, - list item, **bold**, *italic*, `code`, [link](https://…)\n\nA blank line starts a new paragraph."} />
        ) : (
          // renderMarkdown escapes everything first; it's the same renderer the help center uses.
          <div className="prose preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(body) || "<p class=\"muted\">Nothing to preview yet.</p>" }} />
        )}
        <label className="checkrow">
          <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
          Published: anyone can read it in the help center
        </label>
        {item && <p className="muted small">Address: /kb/{item.slug} · last edited by {item.updatedBy || "unknown"}</p>}
        <p className="error" role="alert">{error}</p>
      </div>
      {asking && item && (
        <Confirm
          title="Delete this article?"
          message={`"${item.title}" will be removed, and links to it will stop working.`}
          action="Delete"
          danger
          onClose={() => setAsking(false)}
          onConfirm={async () => {
            await api(`/api/kb/${item.id}`, { method: "DELETE" });
            await onSaved(null, "Article deleted");
          }}
        />
      )}
    </div>
  );
}
