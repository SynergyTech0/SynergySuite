"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signIn } from "@/lib/client-session";
import { CalendarPlus, Repeat, Video, X, Copy, Check } from "lucide-react";

type Meeting = {
  id: string; room: string; title: string; description: string;
  start_at: string; duration_min: number; timezone: string;
  rrule: string | null; canceled_at: string | null;
  invitees: { email: string; name: string }[];
};

function rruleLabel(r: string): string {
  const freq = /FREQ=(\w+)/.exec(r)?.[1];
  const iv = Number(/INTERVAL=(\d+)/.exec(r)?.[1] || 1);
  const base = { DAILY: "day", WEEKLY: "week", MONTHLY: "month" }[freq || ""] || "";
  return iv > 1 ? `Every ${iv} ${base}s` : `Weekly`.replace("Weekly", `Every ${base}`);
}

export default function MeetingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = () =>
    fetch("/api/meetings").then((r) => r.json()).then((d) => setMeetings(d.meetings || [])).catch(() => setMeetings([]));

  useEffect(() => { if (session?.user) load(); }, [session]);

  if (status === "loading")
    return <div className="shell"><div className="center"><p className="sub">Loading…</p></div></div>;
  if (!session?.user)
    return (
      <div className="shell"><div className="center"><div className="card">
        <h1 className="h1">My meetings</h1>
        <p className="sub">Sign in to see your scheduled meetings.</p>
        <button className="btn primary" onClick={() => signIn("/meetings")}>Sign in</button>
      </div></div></div>
    );

  const now = Date.now();
  const active = (meetings || []).filter((m) => !m.canceled_at);
  const upcoming = active.filter((m) => m.rrule || new Date(m.start_at).getTime() + m.duration_min * 60000 >= now);
  const past = active.filter((m) => !m.rrule && new Date(m.start_at).getTime() + m.duration_min * 60000 < now);

  const cancel = async (id: string) => {
    if (!confirm("Cancel this meeting and notify invitees?")) return;
    await fetch(`/api/meetings/${id}`, { method: "DELETE" });
    load();
  };
  const copy = (url: string, id: string) => {
    navigator.clipboard.writeText(url); setCopied(id); setTimeout(() => setCopied(null), 1500);
  };

  const Row = (m: Meeting) => {
    const url = `${window.location.origin}/room/${m.room}`;
    const when = new Date(m.start_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    return (
      <div key={m.id} className="mrow">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="mtitle">{m.title}</span>
            {m.rrule && <span className="pill"><Repeat size={11} /> {rruleLabel(m.rrule)}</span>}
          </div>
          <div className="mwhen">{when} · {m.duration_min} min{m.invitees.length ? ` · ${m.invitees.length} invited` : ""}</div>
        </div>
        <div className="macts">
          <button title="Copy link" onClick={() => copy(url, m.id)}>{copied === m.id ? <Check size={15} /> : <Copy size={15} />}</button>
          <button title="Join" className="mjoin" onClick={() => router.push(url)}><Video size={15} /> Join</button>
          <button title="Cancel" className="mcancel" onClick={() => cancel(m.id)}><X size={15} /></button>
        </div>
      </div>
    );
  };

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand"><div className="logo">S</div> SynergyMeet</div>
        <div className="spacer" />
        <a className="btn primary" style={{ width: "auto" }} href="/schedule"><CalendarPlus size={16} /> Schedule</a>
      </div>
      <div className="center" style={{ alignItems: "flex-start" }}>
        <div className="card" style={{ maxWidth: 640, width: "100%" }}>
          <h1 className="h1" style={{ marginTop: 0 }}>My meetings</h1>
          {meetings === null ? (
            <p className="sub">Loading…</p>
          ) : active.length === 0 ? (
            <p className="sub">No meetings yet. <a href="/schedule">Schedule one →</a></p>
          ) : (
            <>
              {upcoming.length > 0 && <div className="mgrouph">Upcoming & recurring</div>}
              {upcoming.map(Row)}
              {past.length > 0 && <div className="mgrouph" style={{ marginTop: 18 }}>Past</div>}
              {past.map(Row)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
