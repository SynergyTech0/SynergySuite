"use client";
import { useRef, useState } from "react";
import type { PhotoFile } from "@/lib/store";

const THUMB = /\.(png|jpe?g|gif|webp)$/i;

function size(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function Library({ initial }: { initial: PhotoFile[] }) {
  const [files, setFiles] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setError("");
    try {
      for (const f of Array.from(list)) {
        const res = await fetch(`/api/files?name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
        if (!res.ok) throw new Error(`${f.name}: ${(await res.json().catch(() => ({}))).error ?? res.statusText}`);
        const { file } = (await res.json()) as { file: PhotoFile };
        setFiles((prev) => [file, ...prev]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(file: PhotoFile) {
    if (!confirm(`Delete ${file.name}?`)) return;
    const res = await fetch(`/api/files/${file.id}`, { method: "DELETE" });
    if (res.ok) setFiles((prev) => prev.filter((f) => f.id !== file.id));
    else setError(`Couldn't delete ${file.name}`);
  }

  return (
    <main className="library">
      <header>
        <h1>Your images</h1>
        <a className="button" href="/edit/new">New image</a>
        <button className="primary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Uploading…" : "Upload"}
        </button>
        <input ref={input} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
      </header>
      {error && <p className="error">{error}</p>}
      {files.length === 0 ? (
        <p className="empty">Upload a photo, PSD or other image to start editing.</p>
      ) : (
        <div className="grid">
          {files.map((f) => (
            <div className="tile" key={f.id}>
              <a
                className="thumb"
                href={`/edit/${f.id}`}
                style={THUMB.test(f.name) ? { backgroundImage: `url(/api/files/${f.id}?v=${encodeURIComponent(f.modified)})` } : undefined}
              >
                {THUMB.test(f.name) ? "" : f.name.split(".").pop()?.toUpperCase()}
              </a>
              <div className="meta">
                <a className="name" href={`/edit/${f.id}`} title={f.name}>{f.name}</a>
                <span>{size(f.size)}</span>
                <button aria-label={`Delete ${f.name}`} onClick={() => remove(f)}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
