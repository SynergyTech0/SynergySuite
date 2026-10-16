"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function NewBoard() {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function create() {
    if (!title.trim() || busy) return;
    setBusy(true);
    const r = await fetch("/api/boards", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    setBusy(false);
    if (r.ok) { const b = await r.json(); router.push(`/b/${b.id}`); }
  }

  return (
    <div className="newrow">
      <input placeholder="New board title…" value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && create()} style={{ minWidth: 260 }} />
      <button className="btn" onClick={create} disabled={busy}>{busy ? "Creating…" : "Create board"}</button>
    </div>
  );
}
