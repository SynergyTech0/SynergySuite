"use client";
import { Bold, Italic, Link as LinkIcon, List, ListOrdered, Paperclip, Send, Trash2, Underline, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { bytes, htmlToText, type AccountSummary } from "@/lib/client";
import { RecipientInput } from "./RecipientInput";

export type Draft = {
  account: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  html: string; // initial body, e.g. the quoted message for a reply
  inReplyTo?: string;
  references?: string[];
};

export function Compose(props: {
  draft: Draft;
  accounts: AccountSummary[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [d, setD] = useState(props.draft);
  const [showCc, setShowCc] = useState(Boolean(props.draft.cc || props.draft.bcc));
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = body.current;
    setD(props.draft);
    if (!el) return;
    el.innerHTML = props.draft.html;
    // Start typing above any quoted message, like Outlook. New mail starts on the To line.
    if (props.draft.to) {
      const range = document.createRange();
      range.setStart(el.firstElementChild ?? el, 0);
      range.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      el.focus();
    }
  }, [props.draft]);

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value });
  const cmd = (name: string, value?: string) => { document.execCommand(name, false, value); body.current?.focus(); };

  async function send() {
    setSending(true);
    setError(null);
    const html = body.current?.innerHTML ?? "";
    const form = new FormData();
    form.set("account", d.account);
    form.set("to", d.to);
    form.set("cc", d.cc);
    form.set("bcc", d.bcc);
    form.set("subject", d.subject);
    form.set("html", html);
    form.set("text", htmlToText(html));
    if (d.inReplyTo) form.set("inReplyTo", d.inReplyTo);
    if (d.references?.length) form.set("references", d.references.join(" "));
    files.forEach((f) => form.append("attachments", f));
    try {
      const res = await fetch("/api/send", { method: "POST", body: form });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "Sending failed");
      props.onSent();
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
    }
  }

  return (
    <section className="reading compose">
      <div className="toolbar">
        <button className="btn primary" disabled={sending || !d.to.trim()} onClick={send}><Send size={15} /> {sending ? "Sending…" : "Send"}</button>
        <button className="tbtn" onClick={() => fileInput.current?.click()}><Paperclip size={16} /> Attach</button>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
        <span className="sep" />
        <button className="tbtn" onClick={() => cmd("bold")} title="Bold"><Bold size={16} /></button>
        <button className="tbtn" onClick={() => cmd("italic")} title="Italic"><Italic size={16} /></button>
        <button className="tbtn" onClick={() => cmd("underline")} title="Underline"><Underline size={16} /></button>
        <button className="tbtn" onClick={() => cmd("insertUnorderedList")} title="Bullets"><List size={16} /></button>
        <button className="tbtn" onClick={() => cmd("insertOrderedList")} title="Numbering"><ListOrdered size={16} /></button>
        <button className="tbtn" title="Link" onClick={() => { const u = prompt("Link address"); if (u && /^(https?:|mailto:)/i.test(u)) cmd("createLink", u); }}><LinkIcon size={16} /></button>
        <span className="grow" />
        <button className="tbtn" onClick={props.onClose} title="Discard"><Trash2 size={16} /> Discard</button>
      </div>
      <div className="fields">
        {props.accounts.length > 1 && (
          <label><span>From</span>
            <select value={d.account} onChange={set("account")}>
              {props.accounts.map((a) => <option key={a.id} value={a.id}>{a.kind === "shared" ? `${a.label} <${a.address}> (shared mailbox)` : a.address}</option>)}
            </select>
          </label>
        )}
        <label><span>To</span><RecipientInput label="To" value={d.to} onChange={(to) => setD((x) => ({ ...x, to }))} autoFocus={!d.to} />
          {!showCc && <button className="linkbtn" onClick={() => setShowCc(true)}>Cc &amp; Bcc</button>}
        </label>
        {showCc && <label><span>Cc</span><RecipientInput label="Cc" value={d.cc} onChange={(cc) => setD((x) => ({ ...x, cc }))} /></label>}
        {showCc && <label><span>Bcc</span><RecipientInput label="Bcc" value={d.bcc} onChange={(bcc) => setD((x) => ({ ...x, bcc }))} /></label>}
        <label><span>Subject</span><input value={d.subject} onChange={set("subject")} placeholder="Add a subject" /></label>
      </div>
      {files.length > 0 && (
        <div className="attachments">
          {files.map((f, i) => (
            <span key={i} className="chip"><Paperclip size={14} /> <span className="fn">{f.name}</span> <span className="muted small">{bytes(f.size)}</span>
              <button className="iconbtn small" onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={12} /></button></span>
          ))}
        </div>
      )}
      {error && <p className="error pad">{error}</p>}
      <div ref={body} className="editor" contentEditable suppressContentEditableWarning />
    </section>
  );
}
