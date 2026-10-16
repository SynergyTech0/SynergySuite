"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signIn } from "@/lib/client-session";
import { CalendarPlus, Check, Copy } from "lucide-react";

const DAYS = [
  { k: "MO", l: "Mon" }, { k: "TU", l: "Tue" }, { k: "WE", l: "Wed" }, { k: "TH", l: "Thu" },
  { k: "FR", l: "Fri" }, { k: "SA", l: "Sat" }, { k: "SU", l: "Sun" },
];

export default function SchedulePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const localTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [duration, setDuration] = useState(30);
  const [invitees, setInvitees] = useState("");
  const [freq, setFreq] = useState<"" | "DAILY" | "WEEKLY" | "MONTHLY">("");
  const [interval, setInterval] = useState(1);
  const [byday, setByday] = useState<string[]>([]);
  const [endMode, setEndMode] = useState<"never" | "count" | "until">("never");
  const [count, setCount] = useState(10);
  const [until, setUntil] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ url: string; sent: number; queued: number } | null>(null);
  const [copied, setCopied] = useState(false);

  if (status === "loading")
    return <div className="shell"><div className="center"><p className="sub">Loading…</p></div></div>;
  if (!session?.user)
    return (
      <div className="shell"><div className="center"><div className="card">
        <h1 className="h1">Schedule a meeting</h1>
        <p className="sub">Sign in to schedule meetings and send invites.</p>
        <button className="btn primary" onClick={() => signIn("/schedule")}>
          Sign in
        </button>
      </div></div></div>
    );

  const toggleDay = (k: string) =>
    setByday((d) => (d.includes(k) ? d.filter((x) => x !== k) : [...d, k]));

  const submit = async () => {
    setError(null);
    if (!title.trim()) return setError("Give the meeting a title.");
    if (!date) return setError("Pick a date.");
    const startAt = new Date(`${date}T${time}:00`);
    if (isNaN(startAt.getTime())) return setError("That date/time isn't valid.");

    const recurrence = freq
      ? {
          freq, interval,
          byday: freq === "WEEKLY" && byday.length ? byday : undefined,
          count: endMode === "count" ? count : undefined,
          until: endMode === "until" && until ? new Date(`${until}T23:59:00`).toISOString() : undefined,
        }
      : null;

    setBusy(true);
    try {
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, description,
          startAt: startAt.toISOString(),
          durationMin: duration, timezone: localTz,
          recurrence,
          invitees: invitees.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Could not schedule."); return; }
      const results = (data.invites || []) as { sent: boolean }[];
      setDone({
        url: `${window.location.origin}/room/${data.meeting.room}`,
        sent: results.filter((r) => r.sent).length,
        queued: results.filter((r) => !r.sent).length,
      });
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <div className="shell">
        <div className="topbar"><div className="brand"><div className="logo">S</div> SynergyMeet</div></div>
        <div className="center"><div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Check size={22} color="#22c55e" /><h1 className="h1" style={{ margin: 0 }}>Scheduled</h1>
          </div>
          <p className="sub">
            {done.sent > 0 && `Invite sent to ${done.sent} ${done.sent === 1 ? "person" : "people"}. `}
            {done.queued > 0 && `${done.queued} invite${done.queued === 1 ? "" : "s"} queued (email not configured yet). `}
            Share the link below or open it to start.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input readOnly value={done.url} style={{ flex: 1 }} />
            <button className="btn" style={{ width: "auto" }} onClick={() => { navigator.clipboard.writeText(done.url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button className="btn primary" onClick={() => router.push(done.url)}>Open meeting</button>
            <button className="btn ghost" style={{ width: "auto" }} onClick={() => router.push("/meetings")}>My meetings</button>
          </div>
        </div></div>
      </div>
    );

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand"><div className="logo">S</div> SynergyMeet</div>
        <div className="spacer" />
        <a className="btn ghost" style={{ width: "auto" }} href="/meetings">My meetings</a>
      </div>
      <div className="center">
        <div className="card" style={{ maxWidth: 560 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <CalendarPlus size={22} color="var(--accent)" />
            <h1 className="h1" style={{ margin: 0 }}>Schedule a meeting</h1>
          </div>
          <p className="sub">Pick a time, add people, and we'll email a calendar invite with the join link.</p>

          <label className="fld">Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly sync" />
          </label>
          <label className="fld">Description <span className="opt">(optional)</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Agenda, notes…" />
          </label>
          <div style={{ display: "flex", gap: 10 }}>
            <label className="fld" style={{ flex: 1 }}>Date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="fld" style={{ width: 120 }}>Time
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
            <label className="fld" style={{ width: 120 }}>Duration
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {[15, 30, 45, 60, 90, 120].map((d) => <option key={d} value={d}>{d} min</option>)}
              </select>
            </label>
          </div>
          <p className="sub" style={{ margin: "-6px 0 10px", fontSize: 12 }}>Your timezone: {localTz}</p>

          <label className="fld">Repeat
            <select value={freq} onChange={(e) => setFreq(e.target.value as any)}>
              <option value="">Does not repeat</option>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </label>

          {freq && (
            <div className="recur">
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="opt">Every</span>
                <input type="number" min={1} max={30} value={interval} onChange={(e) => setInterval(Number(e.target.value))} style={{ width: 64 }} />
                <span className="opt">{freq === "DAILY" ? "day(s)" : freq === "WEEKLY" ? "week(s)" : "month(s)"}</span>
              </div>
              {freq === "WEEKLY" && (
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {DAYS.map((d) => (
                    <button key={d.k} type="button" onClick={() => toggleDay(d.k)}
                      className={`day ${byday.includes(d.k) ? "on" : ""}`}>{d.l}</button>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                <span className="opt">Ends</span>
                <select value={endMode} onChange={(e) => setEndMode(e.target.value as any)} style={{ width: "auto" }}>
                  <option value="never">Never</option>
                  <option value="count">After N times</option>
                  <option value="until">On date</option>
                </select>
                {endMode === "count" && <input type="number" min={1} max={365} value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ width: 80 }} />}
                {endMode === "until" && <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} style={{ width: "auto" }} />}
              </div>
            </div>
          )}

          <label className="fld">Invite people <span className="opt">(emails, comma or space separated)</span>
            <textarea value={invitees} onChange={(e) => setInvitees(e.target.value)} rows={2} placeholder="alex@acme.com, sam@acme.com" />
          </label>

          {error && <div className="err">{error}</div>}
          <button className="btn primary" onClick={submit} disabled={busy} style={{ marginTop: 6 }}>
            {busy ? "Scheduling…" : "Schedule & send invites"}
          </button>
        </div>
      </div>
    </div>
  );
}
