"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/client-session";
import { LiveKitRoom, PreJoin, type LocalUserChoices } from "@livekit/components-react";
import Room from "@/components/Room";
import { Video } from "lucide-react";

type IceServer = { urls: string | string[]; username?: string; credential?: string };
type TokenResp = { token: string; url: string; identity: string; isStaff: boolean; iceServers?: IceServer[] };

export default function RoomPage() {
  const { name } = useParams<{ name: string }>();
  const router = useRouter();
  const { data: session, status } = useSession();

  const [choices, setChoices] = useState<LocalUserChoices | null>(null);
  const [conn, setConn] = useState<TokenResp | null>(null);
  const [activeRoom, setActiveRoom] = useState<string>(name);
  const [error, setError] = useState<string | null>(null);
  const switchingRef = useRef(false);

  const isStaff = Boolean(session?.user);

  // Hard-release every camera/mic the page is holding. LiveKit only auto-stops tracks it created
  // itself; PreJoin's lobby-preview tracks are "user-provided", so muting/leaving never turns the
  // camera light off. We stop them by hand: at the lobby->room handoff and whenever the page unmounts.
  const releaseAllMedia = useCallback(() => {
    document.querySelectorAll("video, audio").forEach((el) => {
      const s = (el as HTMLMediaElement).srcObject as MediaStream | null;
      if (s && typeof s.getTracks === "function") s.getTracks().forEach((t) => t.stop());
      (el as HTMLMediaElement).srcObject = null;
    });
  }, []);

  // Leaving the page entirely (disconnect -> "/", tab close) must free the devices.
  useEffect(() => {
    window.addEventListener("pagehide", releaseAllMedia);
    return () => {
      window.removeEventListener("pagehide", releaseAllMedia);
      releaseAllMedia();
    };
  }, [releaseAllMedia]);

  // MUST be memoized: LiveKitRoom builds its internal Room from this object's identity, so a fresh
  // literal on every render makes it disconnect + reconnect in a loop (camera blips on/off). Keyed
  // on the chosen devices, it's created once and stays stable across re-renders (e.g. useSession).
  const roomOptions = useMemo(
    () => ({
      videoCaptureDefaults: { deviceId: choices?.videoDeviceId },
      audioCaptureDefaults: { deviceId: choices?.audioDeviceId },
    }),
    [choices?.videoDeviceId, choices?.audioDeviceId],
  );

  // Hand the browser our coturn TURN servers (minted per-join by /api/token). Remote clients behind
  // symmetric NAT need a working relay for the subscriber connection; LiveKit's embedded TURN
  // wasn't sustaining it, so relay now runs through coturn (TURNS on 5349 is reachable everywhere).
  const connectOptions = useMemo(
    () => (conn?.iceServers ? { rtcConfig: { iceServers: conn.iceServers } } : undefined),
    [conn?.iceServers],
  );

  // The lobby ("green room"): preview camera, pick mic/cam/speaker, set your name — before joining.
  // Google Meet's most recognisable pre-call moment, and LiveKit's PreJoin gives it to us directly.
  const onPreJoin = useCallback(
    async (c: LocalUserChoices) => {
      setError(null);
      const res = await fetch("/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Staff identity comes from the session server-side; the guest name is what they typed here.
        body: JSON.stringify({ room: name, guestName: isStaff ? undefined : c.username }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Could not join"); return; }
      // Free the lobby preview camera/mic BEFORE the room re-acquires the same device, so the
      // preview track can't linger and hold the camera light on for the whole call.
      releaseAllMedia();
      setChoices(c);
      setConn(data);
    },
    [name, isStaff, releaseAllMedia],
  );

  // Move this participant to another LiveKit room (a breakout, or back to main) WITHOUT re-doing the
  // lobby: re-mint a token for the target room reusing the same device choices, then swap. The
  // LiveKitRoom is keyed on the active room so it cleanly reconnects.
  const switchRoom = useCallback(
    async (target: string) => {
      if (!choices || target === activeRoom) return;
      switchingRef.current = true; // so the unmount's onDisconnected doesn't bounce us to "/"
      try {
        const res = await fetch("/api/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room: target, guestName: isStaff ? undefined : choices.username }),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error || "Could not switch rooms"); return; }
        setConn(data);
        setActiveRoom(target);
      } finally {
        setTimeout(() => { switchingRef.current = false; }, 2500);
      }
    },
    [choices, activeRoom, isStaff],
  );

  if (conn && choices) {
    return (
      <div className="roomwrap">
        <LiveKitRoom
          key={activeRoom}
          token={conn.token}
          serverUrl={conn.url}
          connect
          video={choices.videoEnabled}
          audio={choices.audioEnabled}
          onDisconnected={() => { if (!switchingRef.current) router.push("/"); }}
          data-lk-theme="default"
          style={{ height: "100dvh" }}
          options={roomOptions}
          connectOptions={connectOptions}
        >
          <Room
            isStaff={conn.isStaff}
            roomName={activeRoom}
            baseRoom={name}
            selfIdentity={conn.identity}
            onSwitchRoom={switchRoom}
          />
        </LiveKitRoom>
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand"><div className="logo">S</div> SynergyMeet</div>
      </div>
      <div className="center">
        <div className="card lobby">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <Video size={22} color="var(--accent)" />
            <h1 className="h1" style={{ margin: 0 }}>Ready to join?</h1>
          </div>
          <p className="sub"><code>{name}</code></p>

          {status === "loading" ? (
            <p className="sub">Loading…</p>
          ) : (
            <div data-lk-theme="default" className="prejoin">
              <PreJoin
                onSubmit={onPreJoin}
                defaults={{ username: session?.user?.name || "" }}
                joinLabel="Join now"
                persistUserChoices
              />
            </div>
          )}

          {!isStaff && (
            <p className="sub" style={{ marginTop: 12, fontSize: 13 }}>
              Joining as a guest. Part of the team?{" "}
              <a href={`/signin?rd=/room/${name}`}>Sign in</a>.
            </p>
          )}
          {error && <div className="err">{error}</div>}
        </div>
      </div>
    </div>
  );
}
