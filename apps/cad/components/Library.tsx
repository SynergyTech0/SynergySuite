"use client";
import { useEffect, useRef, useState } from "react";
import { editorFor } from "@/lib/model";
import { sharePath } from "@/lib/share";
import type { Drawing, Share } from "@/lib/store";
import { MAX_THUMB_TEXT, uploadDxfThumb } from "@/lib/thumbnail";

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;

function size(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const parentOf = (folder: string) => folder.split("/").slice(0, -1).join("/");
const leaf = (folder: string) => folder.split("/").pop() ?? folder;
const folderHref = (folder: string) => (folder ? `/?folder=${encodeURIComponent(folder)}` : "/");
const inFolder = (f: Drawing) => f.folder ?? "";

/** The tile's picture: an exported image itself, or the picture the editors made of the drawing or model. */
function picture(f: Drawing): string | undefined {
  if (IMAGE.test(f.name)) return `url(/api/files/${f.id}?v=${encodeURIComponent(f.modified)})`;
  if (f.thumb) return `url(/api/files/${f.id}/thumb?v=${encodeURIComponent(f.thumb)})`;
  return undefined;
}

/** The user's drawings and models in folders. Files move by dragging them onto a folder, or with Move. */
export function Library({ initial, folders: initialFolders, folder }: { initial: Drawing[]; folders: string[]; folder: string }) {
  const [files, setFiles] = useState(initial);
  const [folders, setFolders] = useState(initialFolders);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const [sharing, setSharing] = useState<Drawing | null>(null);
  const [moving, setMoving] = useState<Drawing | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const here = files.filter((f) => inFolder(f) === folder);
  const subfolders = folders.filter((f) => parentOf(f) === folder);
  const q = `&folder=${encodeURIComponent(folder)}`;
  const crumbs = folder ? folder.split("/").map((_, i, all) => all.slice(0, i + 1).join("/")) : [];

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setError("");
    try {
      for (const f of Array.from(list)) {
        const res = await fetch(`/api/files?name=${encodeURIComponent(f.name)}${q}`, { method: "POST", body: f });
        if (!res.ok) throw new Error(`${f.name}: ${(await res.json().catch(() => ({}))).error ?? res.statusText}`);
        let { file } = (await res.json()) as { file: Drawing };
        setFiles((prev) => [file, ...prev]);
        // DXF is text, so its picture can be made here; DWG and 3D files get theirs when first opened.
        if (/\.dxf$/i.test(f.name) && f.size <= MAX_THUMB_TEXT) {
          const thumb = await uploadDxfThumb(file.id, await f.text());
          if (thumb) file = { ...file, thumb };
          setFiles((prev) => prev.map((x) => (x.id === file.id ? file : x)));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(file: Drawing) {
    if (!confirm(`Delete ${file.name}?`)) return;
    const res = await fetch(`/api/files/${file.id}`, { method: "DELETE" });
    if (res.ok) setFiles((prev) => prev.filter((f) => f.id !== file.id));
    else setError(`Couldn't delete ${file.name}`);
  }

  async function move(id: string, to: string) {
    setError("");
    const res = await fetch(`/api/files/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder: to }) });
    if (!res.ok) return setError("Couldn't move that file.");
    const { file } = (await res.json()) as { file: Drawing };
    setFiles((prev) => prev.map((f) => (f.id === id ? file : f)));
  }

  async function newFolder() {
    const name = prompt("Folder name")?.trim();
    if (!name) return;
    if (name.includes("/")) return setError("A folder name can't contain /.");
    const res = await fetch("/api/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: folder ? `${folder}/${name}` : name }) });
    if (!res.ok) return setError((await res.json().catch(() => null))?.error ?? "Couldn't make that folder.");
    const { folder: made } = (await res.json()) as { folder: string };
    setFolders((prev) => [...new Set([...prev, made])].sort((a, b) => a.localeCompare(b)));
  }

  async function removeFolder(path: string) {
    const res = await fetch(`/api/folders?path=${encodeURIComponent(path)}`, { method: "DELETE" });
    if (res.ok) setFolders((prev) => prev.filter((f) => f !== path));
    else setError((await res.json().catch(() => null))?.error ?? "Couldn't remove that folder.");
  }

  /** Drop targets: folder tiles and the path above the grid. */
  const dropProps = (to: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("application/x-cad-file")) return;
      e.preventDefault();
      setDropTarget(to);
    },
    onDragLeave: () => setDropTarget((t) => (t === to ? null : t)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      const id = e.dataTransfer.getData("application/x-cad-file");
      if (id) void move(id, to);
    },
  });

  /** Keeps the tile's "Shared" mark in step with the share panel. */
  function shareChanged(id: string, token: string | undefined) {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, shared: token } : f)));
  }

  const count = (path: string) => files.filter((f) => inFolder(f) === path || inFolder(f).startsWith(`${path}/`)).length;

  return (
    <main className="library">
      <header>
        <h1>
          <a href="/" className={dropTarget === "" && folder ? "crumb drop" : "crumb"} {...(folder ? dropProps("") : {})}>Your drawings</a>
          {crumbs.map((c) => (
            <span key={c}>
              <span className="sep" aria-hidden>/</span>
              <a href={folderHref(c)} className={dropTarget === c && c !== folder ? "crumb drop" : "crumb"} {...(c !== folder ? dropProps(c) : {})}>
                {leaf(c)}
              </a>
            </span>
          ))}
        </h1>
        <button onClick={() => void newFolder()}>New folder</button>
        <a className="button" href={`/edit/new?${q.slice(1)}`}>New drawing</a>
        <a className="button" href={`/model/new?${q.slice(1)}`}>New 3D model</a>
        <button className="primary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Uploading…" : "Upload"}
        </button>
        <input ref={input} type="file" accept=".dwg,.dxf,.cd,.step,.stp,.iges,.igs,.brep,.stl" multiple hidden onChange={(e) => upload(e.target.files)} />
      </header>
      {error && <p className="error">{error}</p>}
      {here.length === 0 && subfolders.length === 0 ? (
        <p className="empty">
          {folder ? "This folder is empty. Upload a file here, or drag one onto it from another folder." : "Upload a DWG or DXF drawing or a STEP, IGES or STL model, or start a new one."}
        </p>
      ) : (
        <div className="grid">
          {subfolders.map((path) => (
            <div className={dropTarget === path ? "tile folder drop" : "tile folder"} key={path} {...dropProps(path)}>
              <a className="thumb" href={folderHref(path)} aria-label={`Open folder ${leaf(path)}`}>
                <span className="folder-icon" aria-hidden />
              </a>
              <div className="meta">
                <a className="name" href={folderHref(path)} title={path}>{leaf(path)}</a>
                <span className="size">{count(path) === 1 ? "1 file" : `${count(path)} files`}</span>
                {count(path) === 0 && !folders.some((f) => f.startsWith(`${path}/`)) && (
                  <button aria-label={`Remove folder ${leaf(path)}`} title="Remove this empty folder" onClick={() => void removeFolder(path)}>✕</button>
                )}
              </div>
            </div>
          ))}
          {here.map((f) => {
            // Drawings open in the 2D editor and models in the 3D one; exports (PDF, SVG, PNG)
            // open or download as files.
            const editor = editorFor(f.name);
            const href = editor ? `/${editor}/${f.id}` : `/api/files/${f.id}`;
            const bg = picture(f);
            return (
              <div
                className="tile"
                key={f.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-cad-file", f.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
              >
                <a className={bg ? "thumb pic" : "thumb"} href={href} style={bg ? { backgroundImage: bg } : undefined} draggable={false}>
                  {bg ? "" : f.name.split(".").pop()?.toUpperCase()}
                </a>
                <div className="meta">
                  <a className="name" href={href} title={f.name} draggable={false}>{f.name}</a>
                  <span className="size">{size(f.size)}</span>
                  {f.shared && <span className="shared-mark" title="Anyone with the link can view this">Shared</span>}
                  <details className="menu">
                    <summary aria-label={`More for ${f.name}`} title="More">⋯</summary>
                    <div>
                      <button onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; setSharing(f); }}>Share…</button>
                      <button onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; setMoving(f); }}>Move to…</button>
                      <button className="danger" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; void remove(f); }}>Delete</button>
                    </div>
                  </details>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {sharing && <SharePanel file={sharing} onChange={(token) => shareChanged(sharing.id, token)} onClose={() => setSharing(null)} />}
      {moving && <MovePanel file={moving} folders={folders} onMove={(to) => void move(moving.id, to)} onClose={() => setMoving(null)} />}
    </main>
  );
}

/** Picks a folder to move a file to. */
function MovePanel({ file, folders, onMove, onClose }: { file: Drawing; folders: string[]; onMove: (to: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [to, setTo] = useState(file.folder ?? "");
  useEffect(() => dialog.current?.showModal(), []);
  return (
    <dialog ref={dialog} className="share-panel" onClose={onClose}>
      <h2>Move {file.name}</h2>
      <p className="hint">Pick the folder it goes in. You can also drag a file onto a folder.</p>
      <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Folder" className="folder-select">
        <option value="">Your drawings (top)</option>
        {folders.map((f) => (
          <option key={f} value={f}>{f.split("/").join(" / ")}</option>
        ))}
      </select>
      <div className="actions">
        <button onClick={() => dialog.current?.close()}>Cancel</button>
        <button
          className="primary"
          disabled={to === (file.folder ?? "")}
          onClick={() => {
            onMove(to);
            dialog.current?.close();
          }}
        >
          Move
        </button>
      </div>
    </dialog>
  );
}

/** Makes, copies or stops a file's view-only link, and shows how many review comments it has. */
function SharePanel({ file, onChange, onClose }: { file: Drawing; onChange: (token: string | undefined) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [share, setShare] = useState<Share | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const url = share ? `${location.origin}${sharePath(share.token)}` : "";

  useEffect(() => {
    dialog.current?.showModal();
    void (async () => {
      const res = await fetch(`/api/files/${file.id}/share`).catch(() => null);
      if (!res?.ok) return setError("Couldn't check this file's link.");
      setShare(((await res.json()) as { share: Share | null }).share);
    })();
  }, [file.id]);

  async function create() {
    setError("");
    const res = await fetch(`/api/files/${file.id}/share`, { method: "POST" }).catch(() => null);
    if (!res?.ok) return setError("Couldn't make a link.");
    const next = ((await res.json()) as { share: Share }).share;
    setShare(next);
    onChange(next.token);
  }

  async function stop() {
    if (!confirm(`Stop sharing ${file.name}? The link stops working and its comments are removed.`)) return;
    const res = await fetch(`/api/files/${file.id}/share`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return setError("Couldn't stop sharing.");
    setShare(null);
    onChange(undefined);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError("Couldn't copy. Select the link and copy it.");
    }
  }

  const comments = share?.comments.length ?? 0;
  return (
    <dialog ref={dialog} className="share-panel" onClose={onClose}>
      <h2>Share {file.name}</h2>
      <p className="hint">Anyone with the link can view the file and leave comments, without an account. They can't change it.</p>
      {share === undefined && !error && <p>Checking…</p>}
      {share === null && (
        <button className="primary" onClick={() => void create()}>Make a view-only link</button>
      )}
      {share && (
        <>
          <div className="link">
            <input readOnly value={url} aria-label="Share link" onFocus={(e) => e.target.select()} />
            <button onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <p className="count">
            {comments === 0 ? "No comments yet." : `${comments} comment${comments === 1 ? "" : "s"}.`}{" "}
            <a href={sharePath(share.token)} target="_blank" rel="noopener">Open the review page</a>
          </p>
        </>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        {share ? <button className="danger" onClick={() => void stop()}>Stop sharing</button> : <span />}
        <button onClick={() => dialog.current?.close()}>Done</button>
      </div>
    </dialog>
  );
}
