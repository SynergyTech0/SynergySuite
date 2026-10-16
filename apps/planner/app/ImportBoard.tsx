"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Import a Trello JSON export or a Jira CSV.
 *
 * The file is read in the browser and posted as text: no upload endpoint, no file sitting on disk,
 * and the same request shape for both formats. What the import could not bring across is shown
 * before navigating away — the things people notice missing later are better said now.
 */
export function ImportBoard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ boardId: string; summary: { lists: number; cards: number; skipped: string[] } } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function chosen(f: File | undefined) {
    if (!f || busy) return;
    setBusy(true); setError(null); setDone(null);
    const kind = f.name.toLowerCase().endsWith(".csv") ? "jira" : "trello";
    const text = await f.text();
    const title = kind === "jira" ? f.name.replace(/\.csv$/i, "") : undefined;
    const r = await fetch("/api/import", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, text, title }),
    });
    setBusy(false);
    if (file.current) file.current.value = "";       // so the same file can be chosen again
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error || "That file could not be imported."); return; }
    setDone(await r.json());
  }

  return (
    <div className="importrow">
      <input ref={file} type="file" accept=".json,.csv,application/json,text/csv" style={{ display: "none" }}
        onChange={(e) => chosen(e.target.files?.[0])} />
      <button className="mini" onClick={() => file.current?.click()} disabled={busy}>
        {busy ? "Importing…" : "Import from Trello or Jira"}
      </button>
      <span className="muted">Trello’s “Export as JSON”, or a Jira CSV export</span>

      {error && <div className="bnote warn" onClick={() => setError(null)}>{error} <span className="mini">dismiss</span></div>}
      {done && (
        <div className="bnote" onClick={() => router.push(`/b/${done.boardId}`)}>
          Imported {done.summary.cards} card{done.summary.cards === 1 ? "" : "s"} into {done.summary.lists} list
          {done.summary.lists === 1 ? "" : "s"}. <b>Open the board →</b>
          {done.summary.skipped.length > 0 && (
            <div className="muted" style={{ marginTop: 4 }}>Not imported: {done.summary.skipped.join("; ")}.</div>
          )}
        </div>
      )}
    </div>
  );
}
