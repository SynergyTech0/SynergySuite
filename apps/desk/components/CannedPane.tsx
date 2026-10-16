"use client";
import { ArrowLeft, MessageSquareText, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Canned } from "@/lib/types";
import { Confirm } from "./Modal";
import { api } from "./client";

export function CannedList({ canned, pick, onPick }: { canned: Canned[]; pick: number | "new" | null; onPick: (p: number | "new") => void }) {
  return (
    <section className="listpane">
      <div className="listhead">
        <div className="titlerow">
          <h1 className="grow">Canned replies</h1>
          <button className="btn small" onClick={() => onPick("new")}><Plus size={15} /> New</button>
        </div>
        <p className="muted small hint">Ready-made answers anyone on the desk can drop into a reply.</p>
      </div>
      <div className="listbody">
        {canned.length ? (
          <ul className="tlist">
            {canned.map((c) => (
              <li key={c.id}>
                <button className={`trow${pick === c.id ? " sel" : ""}`} onClick={() => onPick(c.id)}>
                  <div className="trowtop"><span className="tfrom">{c.title}</span></div>
                  <div className="tpreview">{c.body}</div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty grow"><MessageSquareText size={40} strokeWidth={1.2} /><p>No canned replies yet.</p></div>
        )}
      </div>
    </section>
  );
}

export function CannedPane({ item, open, onBack, onSaved }: {
  item: Canned | null; open: boolean; onBack: () => void; onSaved: (c: Canned | null) => Promise<void>;
}) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [body, setBody] = useState(item?.body ?? "");
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  if (!open) return <div className="empty"><MessageSquareText size={40} strokeWidth={1.2} /><p>Pick a reply to edit it, or make a new one.</p></div>;

  const save = async () => {
    setError("");
    try {
      const c = item
        ? await api<Canned>(`/api/canned/${item.id}`, { method: "PATCH", json: { title, body } })
        : await api<Canned>("/api/canned", { method: "POST", json: { title, body } });
      await onSaved(c);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="editor">
      <div className="editorhead">
        <button className="iconbtn back" aria-label="Back" onClick={onBack}><ArrowLeft size={18} /></button>
        <h2 className="grow">{item ? "Edit canned reply" : "New canned reply"}</h2>
        {item && (
          <button className="btn ghost" onClick={() => setAsking(true)}><Trash2 size={16} /> Delete</button>
        )}
        <button className="btn primary" disabled={!title.trim() || !body.trim()} onClick={() => void save()}>Save</button>
      </div>
      <div className="form editorbody">
        <label><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!item} placeholder="e.g. Password reset steps" /></label>
        <label>
          <span>Reply text</span>
          <textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} placeholder={"Hi {{name}},\n\n…"} />
        </label>
        <p className="muted small">{"{{name}}"} becomes the requester&apos;s first name and {"{{number}}"} the ticket number when you insert the reply.</p>
        <p className="error" role="alert">{error}</p>
      </div>
      {asking && item && (
        <Confirm
          title="Delete this canned reply?"
          message={`"${item.title}" will be removed for everyone on the desk.`}
          action="Delete"
          danger
          onClose={() => setAsking(false)}
          onConfirm={async () => {
            await api(`/api/canned/${item.id}`, { method: "DELETE" });
            await onSaved(null);
          }}
        />
      )}
    </div>
  );
}
