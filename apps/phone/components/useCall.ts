"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { DisconnectReason, type Participant, type RemoteTrack, Room, RoomEvent, Track } from "livekit-client";
import { Tones } from "./client";

/** A call this tab is on, as the call bar shows it. */
export type ActiveCall = {
  callId: string;
  room: string;
  /** The other side, for the header. */
  title: string;
  subtitle: string;
  /** dialing: our own number call; ringing: their phone rings; voicemail: leaving a message. */
  state: "connecting" | "ringing" | "active" | "voicemail" | "ended" | "moved";
  direction: "internal" | "inbound" | "outbound";
  outgoing: boolean;
  answeredAt: number | null;
  muted: boolean;
  held: boolean;
  /** Someone else put this call on hold. */
  heldBy: string | null;
  detail: string | null;
  meetUrl: string | null;
  people: { identity: string; name: string; phone: boolean }[];
};

type Join = { callId: string; room: string; token: string; url: string; state: string; direction: ActiveCall["direction"]; iceServers?: RTCIceServer[] };

const AGENT = "phone-agent";
const DTMF_CODE: Record<string, number> = { "*": 10, "#": 11 };

/**
 * Runs one call in the browser on livekit-client: microphone out, everyone else's audio in, plus
 * mute, hold, keypad tones and the local ringback while the other side rings.
 */
export function useCall(onEnded: () => void) {
  const [call, setCall] = useState<ActiveCall | null>(null);
  const roomRef = useRef<Room | null>(null);
  const tones = useRef<Tones | null>(null);
  const audioEls = useRef(new Map<string, HTMLMediaElement>());
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;

  const tone = () => (tones.current ??= new Tones());

  const update = useCallback((patch: Partial<ActiveCall>) => setCall((c) => (c ? { ...c, ...patch } : c)), []);

  const people = (room: Room) =>
    [...room.remoteParticipants.values()]
      .filter((p) => p.identity !== AGENT)
      .map((p) => ({ identity: p.identity, name: p.name || p.identity, phone: p.identity.startsWith("tel:") || p.identity.startsWith("sip") }));

  const cleanup = useCallback(() => {
    tone().stop();
    for (const el of audioEls.current.values()) el.remove();
    audioEls.current.clear();
    const r = roomRef.current;
    roomRef.current = null;
    if (r) void r.disconnect();
  }, []);

  const join = useCallback(async (j: Join, info: { title: string; subtitle: string; outgoing: boolean }) => {
    cleanup();
    const room = new Room({ adaptiveStream: false, dynacast: false, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    roomRef.current = room;
    const initial: ActiveCall = {
      callId: j.callId, room: j.room, title: info.title, subtitle: info.subtitle, direction: j.direction, outgoing: info.outgoing,
      state: j.state === "active" ? "active" : info.outgoing ? "ringing" : "connecting",
      answeredAt: j.state === "active" ? Date.now() : null, muted: false, held: false, heldBy: null, detail: null, meetUrl: null, people: [],
    };
    setCall(initial);
    // Our own ringback for calls to colleagues; a phone line plays its own.
    if (info.outgoing && j.direction === "internal") tone().ringback();

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, p: Participant) => {
      if (track.kind !== Track.Kind.Audio) return;
      const el = track.attach();
      el.dataset.identity = p.identity;
      document.body.appendChild(el);
      audioEls.current.set(track.sid ?? p.identity, el);
    });
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      track.detach().forEach((el) => el.remove());
      audioEls.current.delete(track.sid ?? "");
    });
    const refresh = () => {
      setCall((c) => (c ? { ...c, people: people(room) } : c));
      // A phone number we called: its answer shows on the participant.
      for (const p of room.remoteParticipants.values()) {
        if (p.attributes?.["sip.callStatus"] === "active") {
          tone().stop();
          setCall((c) => (c && c.state === "ringing" ? { ...c, state: "active", answeredAt: c.answeredAt ?? Date.now() } : c));
        }
      }
    };
    room.on(RoomEvent.ParticipantConnected, refresh);
    room.on(RoomEvent.ParticipantDisconnected, refresh);
    room.on(RoomEvent.ParticipantAttributesChanged, refresh);
    room.on(RoomEvent.DataReceived, (payload, p) => {
      try {
        const m = JSON.parse(new TextDecoder().decode(payload)) as { type?: string; on?: boolean };
        if (m.type === "hold") update({ heldBy: m.on ? p?.name || p?.identity || "Someone" : null });
      } catch {
        /* not ours */
      }
    });
    room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      tone().stop();
      for (const el of audioEls.current.values()) el.remove();
      audioEls.current.clear();
      if (roomRef.current !== room) return;
      roomRef.current = null;
      // Opening the call in Meet signs this tab's connection out (same person, new tab).
      const moved = reason === DisconnectReason.DUPLICATE_IDENTITY;
      setCall((c) => (c ? { ...c, state: moved ? "moved" : "ended", detail: moved ? "Continued in Meet" : c.detail } : c));
      endedRef.current();
    });
    await room.connect(j.url, j.token, j.iceServers ? { rtcConfig: { iceServers: j.iceServers } } : undefined);
    await room.localParticipant.setMicrophoneEnabled(true);
    await room.startAudio().catch(() => {});
    refresh();
  }, [cleanup, update]);

  /** The server said the call changed (answered, voicemail, ended, transferred…). */
  const serverState = useCallback((callId: string, state: string, detail?: string) => {
    setCall((c) => {
      if (!c || c.callId !== callId) return c;
      // Once this tab has left (hung up, transferred), later news about the call isn't ours.
      if (c.state === "ended" || c.state === "moved") return c;
      if (detail?.startsWith("meet:")) return { ...c, meetUrl: detail.slice(5) };
      if (state === "active") {
        tone().stop();
        return { ...c, state: "active", answeredAt: c.answeredAt ?? Date.now(), detail: detail ?? null };
      }
      if (state === "voicemail") {
        tone().stop();
        return { ...c, state: "voicemail", detail: detail ?? "Leave a message after the tone, then hang up" };
      }
      if (state === "ringing") return { ...c, state: "ringing", detail: detail ?? c.detail };
      if (["ended", "missed", "declined", "failed"].includes(state)) {
        tone().stop();
        return { ...c, state: "ended", detail: detail ?? c.detail };
      }
      return { ...c, detail: detail ?? c.detail };
    });
  }, []);

  useEffect(() => {
    if (call?.state === "ended" || call?.state === "moved") {
      cleanup();
      const t = setTimeout(() => setCall((c) => (c && (c.state === "ended" || c.state === "moved") ? null : c)), 2500);
      return () => clearTimeout(t);
    }
  }, [call?.state, cleanup]);

  const mute = useCallback(async (on: boolean) => {
    await roomRef.current?.localParticipant.setMicrophoneEnabled(!on);
    update({ muted: on });
  }, [update]);

  /** Hold: our microphone off and their audio off, and the others are told so. */
  const hold = useCallback(async (on: boolean) => {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(!on);
    for (const p of room.remoteParticipants.values()) for (const pub of p.audioTrackPublications.values()) pub.setEnabled(!on);
    await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: "hold", on })), { reliable: true });
    setCall((c) => (c ? { ...c, held: on, muted: on ? c.muted : false } : c));
  }, []);

  const dtmf = useCallback(async (digit: string) => {
    tone().blip();
    const code = DTMF_CODE[digit] ?? Number(digit);
    await roomRef.current?.localParticipant.publishDtmf(code, digit).catch(() => {});
  }, []);

  const leave = useCallback(() => {
    cleanup();
    setCall((c) => (c ? { ...c, state: "ended" } : c));
  }, [cleanup]);

  useEffect(() => () => cleanup(), [cleanup]);

  return { call, join, serverState, mute, hold, dtmf, leave, update, tones: tone };
}
