"use client";
import { useState } from "react";

type Closed = { id: string; title: string; keyPrefix: string };

/**
 * Closed boards, collapsed by default as in Trello. Reopening and deleting are admin actions; the
 * server enforces that, and a refusal is shown rather than hidden, because an ordinary member cannot
 * know in advance which boards they administer.
 */
export function ClosedBoards() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Closed[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/boards?closed=1");
    setRows(r.ok ? await r.json() : []);
  }
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) await load();
  }
  async function act(url: string, init: RequestInit, done: string) {
    setError(null);
    const r = await fetch(url, init);
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error || `Refused (${r.status}).`); return; }
    if (done === "reopened") window.location.reload(); else load();
  }

  return (
    <div style={{ marginTop: 28 }}>
      <button className="mini" onClick={toggle}>{open ? "▾" : "▸"} Closed boards</button>
      {open && (
        <div style={{ marginTop: 8 }}>
          {error && <div className="bnote warn" style={{ margin: "0 0 8px" }}>{error}</div>}
          {rows?.map((b) => (
            <div key={b.id} className="brow" style={{ cursor: "default", maxWidth: 640 }}>
              <span className="ikey">{b.keyPrefix}</span>
              <span className="btitle">{b.title}</span>
              <button className="mini" onClick={() => act(`/api/boards/${b.id}`,
                { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isClosed: false }) }, "reopened")}>
                Reopen
              </button>
              <button className="mini" onClick={() => {
                if (confirm(`Permanently delete "${b.title}" and every card on it? This cannot be undone.`)) {
                  act(`/api/boards/${b.id}`, { method: "DELETE" }, "deleted");
                }
              }}>Delete</button>
            </div>
          ))}
          {rows && !rows.length && <div className="muted" style={{ fontSize: 13 }}>No closed boards.</div>}
        </div>
      )}
    </div>
  );
}
