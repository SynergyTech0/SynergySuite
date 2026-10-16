"use client";
import { useState } from "react";

export function AcceptInvite({ token, boardId }: { token: string; boardId: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    const r = await fetch("/api/invites/accept", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (r.ok) {
      const d: { boardId: string | null } = await r.json();
      const dest = d.boardId ?? boardId;
      window.location.href = dest ? `/b/${dest}` : "/";
      return;
    }
    setBusy(false);
    setError(r.status === 409 ? "This invitation has already been accepted."
      : r.status === 410 ? "This invitation has expired or been revoked."
      : "Couldn't accept this invitation.");
  }

  return (
    <div style={{ marginTop: 16 }}>
      <button className="btn" onClick={accept} disabled={busy}>{busy ? "Joining…" : "Accept invitation"}</button>
      {error && <p className="warn" style={{ marginTop: 10 }}>{error}</p>}
    </div>
  );
}
