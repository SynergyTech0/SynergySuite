"use client";
import { Bold, Italic, Link as LinkIcon, List, ListOrdered, Paperclip, Send, ShieldAlert, Trash2, Underline, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { bytes, htmlToText, type AccountSummary, type DlpStop, type Label } from "@/lib/client";
import { LabelChip } from "./LabelChip";
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
  labelId?: string | null; // sensitivity label; undefined: the organization's default, null: none
};

export function Compose(props: {
  draft: Draft;
  accounts: AccountSummary[];
  labels: Label[];
  defaultLabelId: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [d, setD] = useState(props.draft);
  const [showCc, setShowCc] = useState(Boolean(props.draft.cc || props.draft.bcc));
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dlp, setDlp] = useState<DlpStop | null>(null);
  const [reason, setReason] = useState("");
  const body = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = body.current;
    setD(props.draft);
    setDlp(null);
    setReason("");
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

  // Labels arrive after the composer may have opened: new mail then takes the default once known.
  const labelId = d.labelId === undefined ? props.defaultLabelId : d.labelId;
  const label = props.labels.find((l) => l.id === labelId) ?? null;

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value });
  const cmd = (name: string, value?: string) => { document.execCommand(name, false, value); body.current?.focus(); };

  /** justification: the reason given to send anyway after a DLP warning. */
  async function send(justification?: string) {
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
    if (label) form.set("labelId", label.id);
    if (justification) form.set("dlpOverride", JSON.stringify({ justification }));
    files.forEach((f) => form.append("attachments", f));
    try {
      const res = await fetch("/api/send", { method: "POST", body: form });
      const out = await res.json().catch(() => ({}));
      if (!res.ok && out.dlp) {
        setDlp(out.dlp);
        setSending(false);
        return;
      }
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
        <button className="btn primary" disabled={sending || !d.to.trim()} onClick={() => send()}><Send size={15} /> {sending ? "Sending…" : "Send"}</button>
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
        {props.labels.length > 0 && (
          <label><span>Label</span>
            <select value={label?.id ?? ""} onChange={(e) => setD({ ...d, labelId: e.target.value || null })} aria-label="Sensitivity label">
              <option value="">No label</option>
              {props.labels.map((l) => <option key={l.id} value={l.id} title={l.description}>{l.name}</option>)}
            </select>
            {label && <LabelChip label={label} />}
            {label?.protection.blockExternal && <span className="labelnote">Only people in your organization</span>}
          </label>
        )}
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
      {dlp && (
        <div className={`policytip ${dlp.action}`} role="alert">
          <ShieldAlert size={18} />
          <div className="grow">
            <strong>{dlp.action === "block" ? "This message can't be sent" : "Check this message before sending"}</strong>
            <p>{dlp.tip}</p>
            {dlp.matches.length > 0 && <p className="small">Found: {dlp.matches.map((m) => `${m.name}${m.count > 1 ? ` (${m.count})` : ""}`).join(", ")}</p>}
            {dlp.outside.length > 0 && <p className="small muted">Outside your organization: {dlp.outside.join(", ")}</p>}
            {dlp.action === "warn" && (
              <div className="override">
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why does this need to be sent?" aria-label="Reason for sending anyway" />
                <button className="btn" disabled={sending || !reason.trim()} onClick={() => send(reason.trim())}>Send anyway</button>
              </div>
            )}
          </div>
          <button className="iconbtn small" onClick={() => setDlp(null)} title="Dismiss"><X size={12} /></button>
        </div>
      )}
      <div ref={body} className="editor" contentEditable suppressContentEditableWarning />
    </section>
  );
}
