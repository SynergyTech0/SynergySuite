"use client";
import { ChevronRight, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { FileIcon } from "./FileIcon";
import { Preview } from "./Preview";
import { api, formatSize, formatWhen, person, previewKind } from "./client";

type P = { id: string; name: string; kind: "file" | "folder"; mime: string; size: number; modifiedAt: string };
type View = { item: P; path: P[]; children: P[]; owner: string };

export function SharedView({ token }: { token: string }) {
  const [at, setAt] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const base = `/api/shared/${encodeURIComponent(token)}`;
  const content = (id: string, inline = false) => `${base}/content?item=${id}${inline ? "&inline=1" : ""}`;

  useEffect(() => {
    api<View>(`${base}${at ? `?item=${at}` : ""}`).then(setView, (e) => setError(e.message));
  }, [base, at]);

  if (error) {
    return (
      <div className="shared pad">
        <h1>This link doesn&apos;t work</h1>
        <p className="muted">{error}</p>
      </div>
    );
  }
  if (!view) return <p className="muted pad">Loading…</p>;

  const files = view.children.filter((c) => c.kind === "file");
  const p = preview ? files.find((f) => f.id === preview) : null;
  const pi = p ? files.indexOf(p) : -1;

  if (view.item.kind === "file") {
    const kind = previewKind(view.item.mime);
    return (
      <div className="shared">
        <div className="sharedhead">
          <FileIcon kind="file" name={view.item.name} size={28} />
          <div className="grow">
            <h1>{view.item.name}</h1>
            <span className="muted small">Shared by {person(view.owner, "")} · {formatSize(view.item.size)}</span>
          </div>
          <a className="btn primary" href={content(view.item.id)}>
            <Download size={16} /> Download
          </a>
        </div>
        <div className="sharedbody">
          {kind === "none" ? (
            <p className="muted">No preview for this kind of file. Download it to open it.</p>
          ) : (
            <Inline kind={kind} src={content(view.item.id, true)} name={view.item.name} size={view.item.size} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="shared">
      <div className="sharedhead">
        <FileIcon kind="folder" name={view.item.name} size={28} />
        <div className="grow">
          <nav className="crumbs">
            {view.path.map((c, i) => (
              <span key={c.id} className="crumb">
                {i > 0 && <ChevronRight size={16} className="muted" />}
                {i === view.path.length - 1 ? <h1>{c.name}</h1> : <button className="linkbtn" onClick={() => setAt(c.id)}>{c.name}</button>}
              </span>
            ))}
          </nav>
          <span className="muted small">Shared by {person(view.owner, "")}</span>
        </div>
        <a className="btn primary" href={content(view.item.id)}>
          <Download size={16} /> Download all
        </a>
      </div>
      <table className="files">
        <thead>
          <tr>
            <th>Name</th>
            <th className="wide">Modified</th>
            <th className="num">Size</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {view.children.map((c) => (
            <tr key={c.id} onDoubleClick={() => (c.kind === "folder" ? setAt(c.id) : setPreview(c.id))}>
              <td>
                <span className="namecell">
                  <FileIcon kind={c.kind} name={c.name} />
                  <button className="namebtn" onClick={() => (c.kind === "folder" ? setAt(c.id) : setPreview(c.id))}>{c.name}</button>
                </span>
              </td>
              <td className="wide muted">{formatWhen(c.modifiedAt)}</td>
              <td className="num muted">{c.kind === "file" ? formatSize(c.size) : ""}</td>
              <td className="num">
                <a className="iconbtn" href={content(c.id)} aria-label={`Download ${c.name}`} title="Download">
                  <Download size={16} />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!view.children.length && <p className="muted pad">This folder is empty.</p>}
      {p && (
        <Preview
          item={p}
          src={content(p.id, true)}
          download={content(p.id)}
          onClose={() => setPreview(null)}
          onPrev={pi > 0 ? () => setPreview(files[pi - 1].id) : undefined}
          onNext={pi < files.length - 1 ? () => setPreview(files[pi + 1].id) : undefined}
        />
      )}
    </div>
  );
}

function Inline({ kind, src, name, size }: { kind: string; src: string; name: string; size: number }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (kind === "text" && size <= 2 * 1024 * 1024) fetch(src).then((r) => r.text()).then(setText, () => setText(""));
  }, [kind, src, size]);
  if (kind === "image") return <img className="viewimg" src={src} alt={name} />;
  if (kind === "pdf") return <iframe className="viewpdf" src={src} title={name} />;
  if (kind === "video") return <video className="viewmedia" src={src} controls />;
  if (kind === "audio") return <audio src={src} controls />;
  return <pre className="viewtext light">{text ?? "Loading…"}</pre>;
}
