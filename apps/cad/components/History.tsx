"use client";
import { useRef, useState } from "react";
import type { Version } from "@/lib/store";

function size(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * "History" in an editor's bar: every earlier save of the open file, to download or restore.
 * Restoring keeps the current bytes as a version too; `onRestored` then reopens the file (by default, reloads the page).
 */
export function History({ fileId, name, onRestored = () => location.reload() }: { fileId: string; name: string; onRestored?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function show() {
    setVersions(null);
    setError("");
    dialog.current?.showModal();
    const res = await fetch(`/api/files/${fileId}/versions`).catch(() => null);
    if (!res?.ok) return setError("Couldn't load the history.");
    setVersions(((await res.json()) as { versions: Version[] }).versions);
  }

  async function restore(v: Version) {
    const when = new Date(v.saved).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    if (!confirm(`Restore ${name} as it was at ${when}? The current version is kept in the history. Unsaved changes in the editor are lost.`)) return;
    setBusy(true);
    const res = await fetch(`/api/files/${fileId}/versions/${v.n}`, { method: "POST" }).catch(() => null);
    if (!res?.ok) {
      setBusy(false);
      return setError("Couldn't restore that version.");
    }
    onRestored();
  }

  return (
    <>
      <button type="button" onClick={() => void show()} title="Earlier versions of this file">
        History
      </button>
      <dialog ref={dialog} className="history-panel">
        <h2>Versions of {name}</h2>
        <p className="hint">Each save keeps the version before it.</p>
        {versions === null && !error && <p>Loading…</p>}
        {versions?.length === 0 && <p>No earlier versions yet. They appear here after you save.</p>}
        {!!versions?.length && (
          <ol>
            {versions.map((v) => (
              <li key={v.n}>
                <time dateTime={v.saved}>{new Date(v.saved).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>
                <span className="size">{size(v.size)}</span>
                <a href={`/api/files/${fileId}/versions/${v.n}`}>Download</a>
                <button type="button" disabled={busy} onClick={() => void restore(v)}>Restore</button>
              </li>
            ))}
          </ol>
        )}
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" onClick={() => dialog.current?.close()}>Close</button>
        </div>
      </dialog>
    </>
  );
}
