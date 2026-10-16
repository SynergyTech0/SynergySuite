"use client";
import { Archive, Flag, Forward, Image as ImageIcon, MailOpen, Paperclip, Reply, ReplyAll, ShieldAlert, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { bytes, displayName, fullAddress, suiteUrl, type MessageDetail } from "@/lib/client";

export type ReplyKind = "reply" | "replyAll" | "forward";

export function ReadingPane(props: {
  message: MessageDetail | null;
  loading: boolean;
  error: string | null;
  attachmentHref: (index: number) => string;
  onReply: (kind: ReplyKind) => void;
  onAction: (action: "delete" | "archive" | "junk" | "unread" | "flag" | "unflag") => void;
  onShowImages: () => void;
}) {
  const m = props.message;
  if (props.error) return <section className="reading"><p className="error pad">{props.error}</p></section>;
  if (!m) {
    return (
      <section className="reading placeholder">
        {props.loading ? <p className="muted">Loading…</p> : <><MailOpen size={40} strokeWidth={1.2} /><p className="muted">Select an item to read</p></>}
      </section>
    );
  }
  return (
    <section className="reading">
      <div className="toolbar">
        <button className="tbtn" onClick={() => props.onReply("reply")}><Reply size={16} /> Reply</button>
        <button className="tbtn" onClick={() => props.onReply("replyAll")}><ReplyAll size={16} /> Reply all</button>
        <button className="tbtn" onClick={() => props.onReply("forward")}><Forward size={16} /> Forward</button>
        <span className="sep" />
        <button className="tbtn" onClick={() => props.onAction("delete")} title="Delete"><Trash2 size={16} /></button>
        <button className="tbtn" onClick={() => props.onAction("archive")} title="Archive"><Archive size={16} /></button>
        <button className="tbtn" onClick={() => props.onAction("junk")} title="Report junk"><ShieldAlert size={16} /></button>
        <button className="tbtn" onClick={() => props.onAction("unread")} title="Mark as unread"><MailOpen size={16} /></button>
        <button className={`tbtn${m.flagged ? " on" : ""}`} onClick={() => props.onAction(m.flagged ? "unflag" : "flag")} title="Flag" aria-pressed={!!m.flagged}><Flag size={16} /></button>
      </div>
      <div className="readbody">
        <h1 className="subject">{m.subject || "(no subject)"}</h1>
        <div className="sender">
          <div className="avatar">{(displayName(m.from) || "?").slice(0, 1).toUpperCase()}</div>
          <div className="meta">
            <div>
              <strong>{displayName(m.from)}</strong> {m.from?.name && <span className="muted">&lt;{m.from.address}&gt;</span>}
              {m.from && (
                <a className="linkbtn addcontact" target="_blank" rel="noopener"
                  href={suiteUrl("contacts", 3190, `/?${new URLSearchParams({ new: "1", email: m.from.address, name: m.from.name })}`)}>
                  Add to contacts
                </a>
              )}
            </div>
            <div className="muted small">To: {m.to.map(fullAddress).join(", ") || "(none)"}</div>
            {m.cc.length > 0 && <div className="muted small">Cc: {m.cc.map(fullAddress).join(", ")}</div>}
          </div>
          <div className="muted small when">{m.date ? new Date(m.date).toLocaleString() : ""}</div>
        </div>
        {m.remoteImages && (
          <div className="banner">
            <ImageIcon size={15} /> Pictures from the internet were blocked to protect your privacy.
            <button className="linkbtn" onClick={props.onShowImages}>Show pictures</button>
          </div>
        )}
        {m.attachments.length > 0 && (
          <div className="attachments">
            {m.attachments.map((a) => (
              <a key={a.index} className="chip" href={props.attachmentHref(a.index)}>
                <Paperclip size={14} /> <span className="fn">{a.filename}</span> <span className="muted small">{bytes(a.size)}</span>
              </a>
            ))}
          </div>
        )}
        {m.html !== null ? <HtmlBody html={m.html} allowRemote={!m.remoteImages} /> : <pre className="plain">{m.text}</pre>}
      </div>
    </section>
  );
}

/**
 * Message HTML is already sanitized on the server. It is shown in a sandboxed iframe with no
 * script permission and a strict content policy, so nothing in it can run or phone home.
 */
function HtmlBody({ html, allowRemote }: { html: string; allowRemote: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const imgSrc = `data: ${typeof window === "undefined" ? "" : window.location.origin}${allowRemote ? " https:" : ""}`;
  const doc = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src ${imgSrc}; font-src data:">
<base target="_blank"><style>body{margin:0;font:14px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;color:#1f2328;word-wrap:break-word}img{max-width:100%;height:auto}blockquote{margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex}</style>
</head><body>${html}</body></html>`;
  useEffect(() => {
    const f = ref.current;
    if (!f) return;
    const fit = () => {
      const h = f.contentDocument?.documentElement.scrollHeight;
      if (h) f.style.height = `${h + 8}px`;
    };
    f.addEventListener("load", fit);
    const t = setInterval(fit, 500); // images arriving late change the height
    return () => { f.removeEventListener("load", fit); clearInterval(t); };
  }, [html]);
  return <iframe ref={ref} className="htmlbody" title="Message" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} />;
}
