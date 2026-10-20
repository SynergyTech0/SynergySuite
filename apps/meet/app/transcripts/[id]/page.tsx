"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useSession, signIn } from "@/lib/client-session";
import { Copy, Check, Download } from "lucide-react";

type Line = { name: string; email: string | null; spoken_at: string; text: string };
type Transcript = { id: string; title: string; started_at: string; ended_at: string | null; people: string[]; segments_list: Line[] };

export default function TranscriptPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session, status } = useSession();
  const [t, setT] = useState<Transcript | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!session?.user) return;
    fetch(`/api/transcripts/${id}`)
      .then(async (r) => { const d = await r.json(); if (r.ok) setT(d); else setError(d.error || "Transcript not found"); })
      .catch(() => setError("Could not load the transcript"));
  }, [session, id]);

  const lines = useMemo(() => {
    const all = t?.segments_list || [];
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((l) => l.text.toLowerCase().includes(needle) || l.name.toLowerCase().includes(needle)) : all;
  }, [t, q]);

  const time = (d: string) => new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const plain = () => (t?.segments_list || []).map((l) => `[${time(l.spoken_at)}] ${l.name}: ${l.text}`).join("\n");

  if (status === "loading")
    return <div className="shell"><div className="center"><p className="sub">Loading…</p></div></div>;
  if (!session?.user)
    return (
      <div className="shell"><div className="center"><div className="card">
        <h1 className="h1">Transcript</h1>
        <p className="sub">Sign in to read this transcript.</p>
        <button className="btn primary" onClick={() => signIn(`/transcripts/${id}`)}>Sign in</button>
      </div></div></div>
    );

  const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand"><div className="logo">S</div> SynergyMeet</div>
        <div className="spacer" />
        <a className="btn ghost" style={{ width: "auto" }} href="/transcripts">All transcripts</a>
      </div>
      <div className="center" style={{ alignItems: "flex-start" }}>
        <div className="card" style={{ maxWidth: 760, width: "100%" }}>
          {error ? (
            <><h1 className="h1" style={{ marginTop: 0 }}>Transcript</h1><p className="sub">{error}</p></>
          ) : !t ? (
            <p className="sub">Loading…</p>
          ) : (
            <>
              <h1 className="h1" style={{ marginTop: 0 }}>{t.title}</h1>
              <p className="sub">
                {new Date(t.started_at).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })}
                {t.ended_at ? "" : " · in progress"}
                {t.people.length ? ` · ${t.people.join(", ")}` : ""}
              </p>
              <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                <input style={{ flex: 1, minWidth: 160 }} placeholder="Search this transcript" value={q} onChange={(e) => setQ(e.target.value)} />
                <button className="btn ghost" style={{ width: "auto" }} onClick={() => { navigator.clipboard.writeText(plain()); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  {copied ? <Check size={15} /> : <Copy size={15} />} Copy
                </button>
                <a className="btn ghost" style={{ width: "auto" }} href={`/api/transcripts/${t.id}?format=txt&tz=${encodeURIComponent(tz)}`}>
                  <Download size={15} /> Download
                </a>
              </div>
              {lines.length === 0 ? (
                <p className="sub">{q ? "Nothing matches." : "Nobody has said anything yet."}</p>
              ) : (
                lines.map((l, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, padding: "8px 0", borderTop: i ? "1px solid var(--line)" : undefined }}>
                    <div className="mwhen" style={{ width: 64, flexShrink: 0 }}>{time(l.spoken_at)}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{l.name}</div>
                      <div style={{ overflowWrap: "anywhere" }}>{l.text}</div>
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
