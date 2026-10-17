"use client";
// The email builder shared by campaigns, templates and automations: the subject and preheader,
// a list of blocks to edit on the left, and the email as a recipient will see it on the right.
import { ArrowDown, ArrowUp, Heading, Image as ImageIcon, Minus, MousePointerClick, Sparkles, StretchVertical, Trash2, Type } from "lucide-react";
import { useEffect, useState } from "react";
import type { Block } from "@/lib/types";
import { api } from "./client";

export type Email = { subject: string; preheader: string; blocks: Block[] };

const NEW: Record<Block["type"], () => Block> = {
  heading: () => ({ type: "heading", text: "A heading", level: 1 }),
  text: () => ({ type: "text", text: "" }),
  button: () => ({ type: "button", text: "Learn more", url: "https://" }),
  image: () => ({ type: "image", url: "https://", alt: "" }),
  divider: () => ({ type: "divider" }),
  spacer: () => ({ type: "spacer", height: 24 }),
};

const ADD: { type: Block["type"]; text: string; icon: React.ReactNode }[] = [
  { type: "heading", text: "Heading", icon: <Heading size={15} /> },
  { type: "text", text: "Text", icon: <Type size={15} /> },
  { type: "button", text: "Button", icon: <MousePointerClick size={15} /> },
  { type: "image", text: "Image", icon: <ImageIcon size={15} /> },
  { type: "divider", text: "Divider", icon: <Minus size={15} /> },
  { type: "spacer", text: "Space", icon: <StretchVertical size={15} /> },
];

export function EmailEditor({ value, onChange, readOnly, ai }: { value: Email; onChange: (v: Email) => void; readOnly?: boolean; ai?: boolean }) {
  const [html, setHtml] = useState("");
  const [subject, setSubject] = useState("");
  const [ideas, setIdeas] = useState<string[] | null>(null);
  const [thinking, setThinking] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => {
      void api<{ html: string; subject: string }>("/api/preview", { method: "POST", json: value })
        .then((r) => {
          setHtml(r.html);
          setSubject(r.subject);
        })
        .catch(() => {});
    }, 350);
    return () => window.clearTimeout(t);
  }, [value]);

  const set = (i: number, b: Block) => onChange({ ...value, blocks: value.blocks.map((x, j) => (j === i ? b : x)) });
  const move = (i: number, d: number) => {
    const next = [...value.blocks];
    const [b] = next.splice(i, 1);
    next.splice(i + d, 0, b);
    onChange({ ...value, blocks: next });
  };
  const remove = (i: number) => onChange({ ...value, blocks: value.blocks.filter((_, j) => j !== i) });

  async function suggest() {
    setThinking(true);
    setErr("");
    try {
      setIdeas((await api<{ subjects: string[] }>("/api/ai/subjects", { method: "POST", json: value })).subjects);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setThinking(false);
    }
  }

  return (
    <div className="editor">
      <div className="blocks">
        <div className="panel">
          <label className="field">
            <span>Subject</span>
            <input value={value.subject} maxLength={200} disabled={readOnly} placeholder="What the email is about" onChange={(e) => onChange({ ...value, subject: e.target.value })} />
          </label>
          {ai && !readOnly && (
            <div style={{ marginTop: 6 }}>
              <button type="button" className="btn small ghost" onClick={suggest} disabled={thinking}>
                <Sparkles size={14} /> {thinking ? "Thinking…" : "Suggest subject lines"}
              </button>
              {err && <p className="error small">{err}</p>}
              {ideas && (
                <div className="suggest">
                  {ideas.map((s) => (
                    <button key={s} type="button" onClick={() => { onChange({ ...value, subject: s }); setIdeas(null); }}>{s}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          <label className="field" style={{ marginTop: 10 }}>
            <span>Preview text (shown after the subject in most inboxes)</span>
            <input value={value.preheader} maxLength={200} disabled={readOnly} onChange={(e) => onChange({ ...value, preheader: e.target.value })} />
          </label>
          <p className="small muted" style={{ margin: "8px 0 0" }}>
            Personalize with {"{{first_name}}"}, {"{{last_name}}"}, {"{{company}}"}, {"{{email}}"} or any custom field like {"{{fields.plan}}"}; add a fallback with {"{{first_name|default: there}}"}.
          </p>
        </div>
        {value.blocks.map((b, i) => (
          <div className="block" key={i}>
            <div className="bhead">
              <span className="grow">{b.type === "spacer" ? "Space" : b.type}</span>
              {!readOnly && (
                <>
                  <button type="button" className="iconbtn small" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
                  <button type="button" className="iconbtn small" aria-label="Move down" disabled={i === value.blocks.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
                  <button type="button" className="iconbtn small" aria-label="Remove block" onClick={() => remove(i)}><Trash2 size={14} /></button>
                </>
              )}
            </div>
            <BlockFields block={b} onChange={(nb) => set(i, nb)} readOnly={readOnly} />
          </div>
        ))}
        {!readOnly && (
          <div className="addblock">
            {ADD.map((a) => (
              <button key={a.type} type="button" className="btn small" onClick={() => onChange({ ...value, blocks: [...value.blocks, NEW[a.type]()] })}>
                {a.icon} {a.text}
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="subjectline">{subject || <span className="muted">(no subject)</span>}</div>
        <iframe className="previewframe" title="Email preview" sandbox="" srcDoc={html} />
      </div>
    </div>
  );
}

function BlockFields({ block: b, onChange, readOnly }: { block: Block; onChange: (b: Block) => void; readOnly?: boolean }) {
  switch (b.type) {
    case "heading":
      return (
        <div className="row">
          <input value={b.text} disabled={readOnly} onChange={(e) => onChange({ ...b, text: e.target.value })} aria-label="Heading text" />
          <select value={b.level ?? 1} disabled={readOnly} onChange={(e) => onChange({ ...b, level: e.target.value === "2" ? 2 : 1 })} aria-label="Size" style={{ width: 110 }}>
            <option value={1}>Large</option>
            <option value={2}>Small</option>
          </select>
        </div>
      );
    case "text":
      return <textarea rows={4} value={b.text} disabled={readOnly} placeholder="**bold**, *italic*, [link text](https://…)" onChange={(e) => onChange({ ...b, text: e.target.value })} aria-label="Text" />;
    case "button":
      return (
        <div className="row">
          <input value={b.text} disabled={readOnly} onChange={(e) => onChange({ ...b, text: e.target.value })} aria-label="Button text" placeholder="Button text" />
          <input value={b.url} disabled={readOnly} onChange={(e) => onChange({ ...b, url: e.target.value })} aria-label="Link" placeholder="https://…" />
          <input type="color" value={b.color || "#0f6cbd"} disabled={readOnly} onChange={(e) => onChange({ ...b, color: e.target.value })} aria-label="Color" style={{ width: 48, padding: 2 }} />
        </div>
      );
    case "image":
      return (
        <>
          <input value={b.url} disabled={readOnly} onChange={(e) => onChange({ ...b, url: e.target.value })} aria-label="Image address" placeholder="Image address (https://…)" />
          <div className="row">
            <input value={b.alt ?? ""} disabled={readOnly} onChange={(e) => onChange({ ...b, alt: e.target.value })} aria-label="Description" placeholder="Description for people who can't see it" />
            <input value={b.link ?? ""} disabled={readOnly} onChange={(e) => onChange({ ...b, link: e.target.value })} aria-label="Link" placeholder="Link (optional)" />
          </div>
        </>
      );
    case "spacer":
      return <input type="range" min={4} max={120} value={b.height ?? 24} disabled={readOnly} onChange={(e) => onChange({ ...b, height: Number(e.target.value) })} aria-label="Height" />;
    default:
      return null;
  }
}
