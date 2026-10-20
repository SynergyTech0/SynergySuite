"use client";

import { useState } from "react";
import { signIn, signOut, useSession } from "@/lib/client-session";
import { useRouter } from "next/navigation";
import { Video, ShieldCheck, LogOut, ArrowRight, CalendarPlus, CalendarClock, ScrollText } from "lucide-react";

export default function Home() {
  const { data: session, status, ssoAvailable } = useSession();
  const router = useRouter();
  const [room, setRoom] = useState("");
  const signedIn = Boolean(session?.user);

  const go = (name: string) => {
    const slug = name.trim().replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 64);
    if (slug) router.push(`/room/${slug}`);
  };

  const newMeeting = () => go(`syn-${Math.random().toString(36).slice(2, 8)}`);

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand"><div className="logo">S</div> SynergyMeet</div>
        <div className="spacer" />
        {signedIn && (
          <>
            <span className="who">{session!.user!.email}</span>
            <button className="btn ghost" style={{ width: "auto" }} onClick={() => signOut()}>
              <LogOut size={15} /> Sign out
            </button>
          </>
        )}
      </div>

      <div className="center">
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <Video size={22} color="var(--accent)" />
            <h1 className="h1" style={{ margin: 0 }}>Start a meeting</h1>
          </div>
          <p className="sub">Video calls that file their own follow-ups — into Boards and Drive.</p>

          {status === "loading" ? (
            <p className="sub">Loading…</p>
          ) : signedIn ? (
            <>
              <button className="btn primary" onClick={newMeeting}>
                <Video size={16} /> New meeting
              </button>

              <div className="divider">or join by name</div>

              <div style={{ display: "flex", gap: 8 }}>
                <input
                  placeholder="Meeting name"
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && go(room)}
                />
                <button
                  className="btn"
                  style={{ width: "auto" }}
                  onClick={() => go(room)}
                  disabled={!room.trim()}
                >
                  <ArrowRight size={16} />
                </button>
              </div>

              <div className="divider">or plan ahead</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" onClick={() => router.push("/schedule")}>
                  <CalendarPlus size={16} /> Schedule a meeting
                </button>
                <button className="btn ghost" style={{ width: "auto" }} onClick={() => router.push("/meetings")}>
                  <CalendarClock size={16} /> My meetings
                </button>
                <button className="btn ghost" style={{ width: "auto" }} onClick={() => router.push("/transcripts")}>
                  <ScrollText size={16} /> Transcripts
                </button>
              </div>
            </>
          ) : (
            <>
              {ssoAvailable ? (
                <button
                  className="btn primary"
                  onClick={() => signIn("/")}
                >
                  <ShieldCheck size={16} /> Sign in
                </button>
              ) : (
                <p className="err">SSO isn&apos;t configured on this deployment.</p>
              )}
              <p className="sub" style={{ marginTop: 16, marginBottom: 0 }}>
                Guest? Open the meeting link you were sent — no account needed.
              </p>
            </>
          )}
        </div>
      </div>

      <div className="foot">Synergy Technologies · one login across Drive, Sign, Boards & Meet</div>
    </div>
  );
}
