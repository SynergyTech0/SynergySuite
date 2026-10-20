"use client";

import { useEffect, useState } from "react";
import { useSession, signIn } from "@/lib/client-session";
import { ScrollText } from "lucide-react";

type Item = { id: string; title: string; started_at: string; ended_at: string | null; people: string[]; segments: number };

export default function TranscriptsPage() {
  const { data: session, status } = useSession();
  const [items, setItems] = useState<Item[] | null>(null);
  const [always, setAlways] = useState(false);

  useEffect(() => {
    if (!session?.user) return;
    fetch("/api/transcripts")
      .then((r) => r.json())
      .then((d) => { setItems(d.transcripts || []); setAlways(Boolean(d.always)); })
      .catch(() => setItems([]));
  }, [session]);

  if (status === "loading")
    return <div className="shell"><div className="center"><p className="sub">Loading…</p></div></div>;
  if (!session?.user)
    return (
      <div className="shell"><div className="center"><div className="card">
        <h1 className="h1">Transcripts</h1>
        <p className="sub">Sign in to see the transcripts of your meetings.</p>
        <button className="btn primary" onClick={() => signIn("/transcripts")}>Sign in</button>
      </div></div></div>
    );

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand"><div className="logo">S</div> SynergyMeet</div>
        <div className="spacer" />
        <a className="btn ghost" style={{ width: "auto" }} href="/meetings">My meetings</a>
      </div>
      <div className="center" style={{ alignItems: "flex-start" }}>
        <div className="card" style={{ maxWidth: 640, width: "100%" }}>
          <h1 className="h1" style={{ marginTop: 0 }}>Transcripts</h1>
          <p className="sub">
            {always
              ? "Every meeting is transcribed. Here are the ones you were in, hosted or were invited to."
              : "Meetings that were transcribed, from the ones you were in, hosted or were invited to."}
          </p>
          {items === null ? (
            <p className="sub">Loading…</p>
          ) : items.length === 0 ? (
            <p className="sub">No transcripts yet.</p>
          ) : (
            items.map((t) => (
              <a key={t.id} className="mrow" href={`/transcripts/${t.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                <ScrollText size={18} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mtitle">{t.title}</div>
                  <div className="mwhen">
                    {new Date(t.started_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                    {t.ended_at ? "" : " · in progress"} · {t.segments} line{t.segments === 1 ? "" : "s"}
                    {t.people.length ? ` · ${t.people.slice(0, 4).join(", ")}${t.people.length > 4 ? ` +${t.people.length - 4}` : ""}` : ""}
                  </div>
                </div>
              </a>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
