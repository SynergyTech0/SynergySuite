"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  ConnectionStateToast,
  Chat,
  TrackToggle,
  DisconnectButton,
  useTracks,
  useParticipants,
  useLocalParticipant,
  useRoomContext,
} from "@livekit/components-react";
import { Track, RoomEvent, LocalParticipant, Participant } from "livekit-client";
import {
  Mic, Video as VideoIcon, MonitorUp, Hand, Smile, Users, MessageSquare,
  Sparkles, PhoneOff, Link2, MicOff, UserX, Circle, Square, Captions,
  FileText, Download, Check, BarChart3, Plus, X, Boxes, ScrollText, Phone,
} from "lucide-react";

const REACTIONS = ["👍", "👏", "🎉", "❤️", "😂", "😮", "🙌"];

/** Ephemeral floating reaction. */
type FloatReaction = { id: number; emoji: string; from: string };

/** One caption line, keyed by speaker; replaced as new utterances land. */
type CaptionLine = { id: string; name: string; text: string; ts: number };

/** A live poll broadcast over the data channel. Votes are tallied client-side by voter identity. */
type Poll = { id: string; question: string; options: string[]; closed: boolean };

export default function Room({
  isStaff, roomName, baseRoom, selfIdentity, onSwitchRoom,
}: {
  isStaff: boolean;
  roomName: string;
  baseRoom?: string;
  selfIdentity?: string;
  onSwitchRoom?: (target: string) => void;
}) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();

  const base = baseRoom || roomName;
  const inBreakout = roomName !== base;
  const breakoutIndex = inBreakout ? roomName.split("__b")[1] : null;

  const [showChat, setShowChat] = useState(false);
  const [showPeople, setShowPeople] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [bgKind, setBgKind] = useState<"none" | "blur" | "vb">("none");
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [showBgMenu, setShowBgMenu] = useState(false);
  const [floats, setFloats] = useState<FloatReaction[]>([]);
  const [copied, setCopied] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recBusy, setRecBusy] = useState(false);
  const [transcribing, setTranscribing] = useState(false); // is the bot running (real state)
  const [captionsOn, setCaptionsOn] = useState(false);     // is the overlay being broadcast
  const [showCaptions, setShowCaptions] = useState(true);  // per-viewer display toggle
  const [capBusy, setCapBusy] = useState(false);
  const [captions, setCaptions] = useState<CaptionLine[]>([]);   // ephemeral overlay (last few)
  const [transcript, setTranscript] = useState<CaptionLine[]>([]); // full running meeting transcript
  const [showTranscript, setShowTranscript] = useState(false);
  const [copiedT, setCopiedT] = useState(false);
  const [poll, setPoll] = useState<Poll | null>(null);          // the active poll (everyone sees)
  const [votes, setVotes] = useState<Record<string, number>>({}); // voterIdentity -> optionIndex
  const [myVote, setMyVote] = useState<number | null>(null);
  const [showPollForm, setShowPollForm] = useState(false);       // host composer open
  const [pollQ, setPollQ] = useState("");
  const [pollOpts, setPollOpts] = useState<string[]>(["", ""]);
  const [breakoutOpen, setBreakoutOpen] = useState(false);       // host: breakouts currently active
  const [breakoutCount, setBreakoutCount] = useState(2);
  const [showBreakoutForm, setShowBreakoutForm] = useState(false);
  const [breakoutMsg, setBreakoutMsg] = useState<string | null>(null); // host broadcast into a breakout
  const floatId = useRef(0);
  const capSeq = useRef(0);
  const transcriptEnd = useRef<HTMLDivElement | null>(null);
  const tlistRef = useRef<HTMLDivElement | null>(null);

  // Reflect the REAL recording state (someone else may have started it), polled lightly.
  useEffect(() => {
    if (!isStaff) return;
    let stop = false;
    const check = async () => {
      try {
        const r = await fetch(`/api/record?room=${encodeURIComponent(roomName)}`);
        const d = await r.json();
        if (!stop) setRecording(Boolean(d.recording));
      } catch {}
    };
    check();
    const t = setInterval(check, 8000);
    return () => { stop = true; clearInterval(t); };
  }, [isStaff, roomName]);

  const toggleRecord = useCallback(async () => {
    setRecBusy(true);
    try {
      const action = recording ? "stop" : "start";
      const r = await fetch("/api/record", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: roomName, action }),
      });
      const d = await r.json();
      if (r.ok) setRecording(Boolean(d.recording));
      else alert(d.error || "Recording failed");
    } finally {
      setRecBusy(false);
    }
  }, [recording, roomName]);

  // Reflect the REAL transcription/caption state (someone else may have started it), polled lightly.
  useEffect(() => {
    if (!isStaff) return;
    let stop = false;
    const check = async () => {
      try {
        const r = await fetch(`/api/captions?room=${encodeURIComponent(roomName)}`);
        const d = await r.json();
        if (!stop) { setTranscribing(Boolean(d.transcribing)); setCaptionsOn(Boolean(d.captions)); }
      } catch {}
    };
    check();
    const t = setInterval(check, 8000);
    return () => { stop = true; clearInterval(t); };
  }, [isStaff, roomName]);

  // Push a desired {transcript, captions} state to the bot and reflect what it reports back.
  const setCaptureState = useCallback(
    async (transcript: boolean, captions: boolean) => {
      setCapBusy(true);
      try {
        const r = await fetch("/api/captions", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room: roomName, transcript, captions }),
        });
        const d = await r.json();
        if (r.ok) { setTranscribing(Boolean(d.transcribing)); setCaptionsOn(Boolean(d.captions)); if (d.captions) setShowCaptions(true); }
        else alert(d.error || "Transcription failed");
      } finally {
        setCapBusy(false);
      }
    },
    [roomName],
  );

  // Transcribe = run the bot silently (records + live transcript panel; no overlay). Turning it off
  // also drops captions (which can't exist without the bot).
  const toggleTranscribe = useCallback(() => {
    const next = !transcribing;
    setCaptureState(next, next ? captionsOn : false);
  }, [transcribing, captionsOn, setCaptureState]);
  // Captions = the visible overlay; turning it on implies transcription is running.
  const toggleCaptions = useCallback(
    () => setCaptureState(true, !captionsOn),
    [captionsOn, setCaptureState],
  );

  // Camera + screenshare tiles. The captions bot is a hidden agent — never show it as a grid tile.
  const allTracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const isBot = (identity?: string) => (identity || "").startsWith("synergy-captions");
  const tracks = allTracks.filter((t) => !isBot(t.participant?.identity));
  const humans = participants.filter((p) => !isBot(p.identity));

  // ---- data channel: reactions (ephemeral) + captions (from the transcription bot) ------------
  useEffect(() => {
    const onData = (payload: Uint8Array, participant?: Participant, _kind?: unknown, topic?: string) => {
      if (topic === "reaction") {
        try {
          const { emoji } = JSON.parse(new TextDecoder().decode(payload));
          const id = ++floatId.current;
          setFloats((f) => [...f, { id, emoji, from: participant?.name || "Someone" }]);
          setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 4000);
        } catch {}
      } else if (topic === "caption") {
        // Overlay only (broadcast just when captions are on): last line per speaker, auto-expiring.
        try {
          const c = JSON.parse(new TextDecoder().decode(payload));
          if (!c?.text) return;
          const ts = c.ts || Date.now();
          setCaptions((prev) => {
            const rest = prev.filter((x) => x.id !== c.identity);
            return [...rest, { id: c.identity, name: c.name || "Speaker", text: c.text, ts }].slice(-3);
          });
        } catch {}
      } else if (topic === "transcript") {
        // Always-on stream while the bot runs: append every utterance to the running transcript.
        try {
          const c = JSON.parse(new TextDecoder().decode(payload));
          if (!c?.text) return;
          const ts = c.ts || Date.now();
          setTranscript((prev) => [...prev, { id: `${ts}-${++capSeq.current}`, name: c.name || "Speaker", text: c.text, ts }]);
        } catch {}
      } else if (topic === "poll") {
        // Host opened (or re-broadcast) a poll. Reset local vote state when the poll id changes.
        try {
          const p = JSON.parse(new TextDecoder().decode(payload)) as Poll & { votes?: Record<string, number> };
          setPoll((prev) => {
            if (prev?.id !== p.id) { setVotes({}); setMyVote(null); }
            return { id: p.id, question: p.question, options: p.options, closed: p.closed };
          });
          if (p.votes) setVotes((v) => ({ ...p.votes, ...v })); // merge host's snapshot (late joiners)
        } catch {}
      } else if (topic === "poll-vote") {
        try {
          const { pollId, voter, option } = JSON.parse(new TextDecoder().decode(payload));
          setPoll((cur) => {
            if (cur && cur.id === pollId) setVotes((v) => ({ ...v, [voter]: option }));
            return cur;
          });
        } catch {}
      } else if (topic === "poll-close") {
        try {
          const { pollId } = JSON.parse(new TextDecoder().decode(payload));
          setPoll((cur) => (cur && cur.id === pollId ? { ...cur, closed: true } : cur));
        } catch {}
      } else if (topic === "breakout") {
        try {
          const m = JSON.parse(new TextDecoder().decode(payload));
          if (m.type === "open" && onSwitchRoom && selfIdentity) {
            const idx = m.assignments?.[selfIdentity];
            if (idx) { setBreakoutMsg(`Joining Breakout ${idx}…`); onSwitchRoom(`${m.base}__b${idx}`); }
          } else if (m.type === "close" && onSwitchRoom && inBreakout) {
            setBreakoutMsg("Returning to the main room…");
            onSwitchRoom(m.base || base);
          } else if (m.type === "message") {
            setBreakoutMsg(m.text || "");
            setTimeout(() => setBreakoutMsg(null), 8000);
          }
        } catch {}
      }
    };
    room.on(RoomEvent.DataReceived, onData as any);
    return () => { room.off(RoomEvent.DataReceived, onData as any); };
  }, [room]);

  // Late-joiner sync: when someone new connects, the host re-broadcasts the active poll + tallies
  // so they see it too (the data channel doesn't replay history).
  useEffect(() => {
    if (!isStaff) return;
    const resend = () => {
      if (!poll) return;
      const payload = new TextEncoder().encode(JSON.stringify({ ...poll, votes }));
      localParticipant.publishData(payload, { reliable: true, topic: "poll" });
    };
    room.on(RoomEvent.ParticipantConnected, resend);
    return () => { room.off(RoomEvent.ParticipantConnected, resend); };
  }, [room, isStaff, poll, votes, localParticipant]);

  // Age out caption lines a few seconds after they stop updating.
  useEffect(() => {
    if (captions.length === 0) return;
    const t = setInterval(() => {
      const now = Date.now();
      setCaptions((prev) => prev.filter((c) => now - c.ts < 7000));
    }, 1000);
    return () => clearInterval(t);
  }, [captions.length]);

  // Belt-and-suspenders device release: stop this participant's own camera/mic on leave, in case
  // LiveKit's disconnect cleanup races the React unmount (the camera light must never linger).
  useEffect(() => {
    const stopMine = () => {
      try {
        room.localParticipant.trackPublications.forEach((pub) => pub.track?.stop());
      } catch {}
    };
    window.addEventListener("pagehide", stopMine);
    return () => { window.removeEventListener("pagehide", stopMine); stopMine(); };
  }, [room]);

  // Jump to the latest line when the panel opens.
  useEffect(() => {
    if (showTranscript) transcriptEnd.current?.scrollIntoView();
  }, [showTranscript]);

  // Follow new lines ONLY if the reader is already near the bottom — never yank them down while
  // they've scrolled up to read something earlier.
  useEffect(() => {
    if (!showTranscript) return;
    const el = tlistRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      transcriptEnd.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcript, showTranscript]);

  const transcriptText = useCallback(
    () =>
      transcript
        .map((l) => {
          const t = new Date(l.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
          return `[${t}] ${l.name}: ${l.text}`;
        })
        .join("\n"),
    [transcript],
  );

  const copyTranscript = useCallback(() => {
    navigator.clipboard.writeText(transcriptText());
    setCopiedT(true);
    setTimeout(() => setCopiedT(false), 1500);
  }, [transcriptText]);

  const downloadTranscript = useCallback(() => {
    const blob = new Blob([`SynergyMeet transcript — ${roomName}\n\n${transcriptText()}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `synergymeet-${roomName}-transcript.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [transcriptText, roomName]);

  // ---- live polls (host launches, everyone votes, results tally client-side) -------------------
  const launchPoll = useCallback(() => {
    const q = pollQ.trim();
    const opts = pollOpts.map((o) => o.trim()).filter(Boolean);
    if (!q || opts.length < 2) return;
    const p: Poll = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, question: q, options: opts, closed: false };
    localParticipant.publishData(new TextEncoder().encode(JSON.stringify(p)), { reliable: true, topic: "poll" });
    setPoll(p); setVotes({}); setMyVote(null);
    setShowPollForm(false); setPollQ(""); setPollOpts(["", ""]);
  }, [pollQ, pollOpts, localParticipant]);

  const castVote = useCallback(
    (option: number) => {
      if (!poll || poll.closed || myVote !== null) return;
      const voter = localParticipant.identity;
      setMyVote(option);
      setVotes((v) => ({ ...v, [voter]: option }));
      localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify({ pollId: poll.id, voter, option })),
        { reliable: true, topic: "poll-vote" },
      );
    },
    [poll, myVote, localParticipant],
  );

  const closePoll = useCallback(() => {
    if (!poll) return;
    localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({ pollId: poll.id })),
      { reliable: true, topic: "poll-close" },
    );
    setPoll((cur) => (cur ? { ...cur, closed: true } : cur));
  }, [poll, localParticipant]);

  const dismissPoll = useCallback(() => { setPoll(null); setVotes({}); setMyVote(null); }, []);

  // ---- breakout rooms (host) -------------------------------------------------------------------
  const openBreakouts = useCallback(
    async (count: number) => {
      // Round-robin everyone in the main room (except the host + the captions bot) into N groups.
      const people = participants.filter(
        (p) => !(p instanceof LocalParticipant) && !(p.identity || "").startsWith("synergy-captions"),
      );
      const assignments: Record<string, number> = {};
      people.forEach((p, i) => { assignments[p.identity] = (i % count) + 1; });
      const r = await fetch("/api/breakout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open", base, assignments }),
      });
      if (r.ok) { setBreakoutOpen(true); setBreakoutCount(count); setShowBreakoutForm(false); }
      else alert((await r.json()).error || "Could not open breakouts");
    },
    [participants, base],
  );

  const closeBreakouts = useCallback(async () => {
    await fetch("/api/breakout", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "close", base, count: breakoutCount }),
    });
    setBreakoutOpen(false);
  }, [base, breakoutCount]);

  const returnToMain = useCallback(() => { onSwitchRoom?.(base); }, [onSwitchRoom, base]);

  const sendReaction = useCallback(
    (emoji: string) => {
      const payload = new TextEncoder().encode(JSON.stringify({ emoji }));
      localParticipant.publishData(payload, { reliable: true, topic: "reaction" });
      // show my own too
      const id = ++floatId.current;
      setFloats((f) => [...f, { id, emoji, from: "You" }]);
      setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 4000);
      setShowReactions(false);
    },
    [localParticipant],
  );

  // ---- raise hand (participant attribute — persists + visible to late joiners) ----------------
  const toggleHand = useCallback(() => {
    const next = !handRaised;
    setHandRaised(next);
    localParticipant.setAttributes({ handRaised: next ? "1" : "" });
  }, [handRaised, localParticipant]);

  // ---- virtual backgrounds (per-user; client-only; dynamic import so the build never needs the wasm)
  // Presets are generated as gradient data-URLs so we ship no binary assets; users can also upload
  // their own image. Each participant's choice is theirs alone — it's applied to their own camera track.
  const bgPresets = useMemo(() => {
    const mk = (a: string, b: string) => {
      const c = document.createElement("canvas");
      c.width = 1280; c.height = 720;
      const ctx = c.getContext("2d");
      if (!ctx) return "";
      const g = ctx.createLinearGradient(0, 0, 1280, 720);
      g.addColorStop(0, a); g.addColorStop(1, b);
      ctx.fillStyle = g; ctx.fillRect(0, 0, 1280, 720);
      return c.toDataURL("image/jpeg", 0.9);
    };
    return [
      { id: "slate", label: "Slate", url: mk("#0f172a", "#334155") },
      { id: "synergy", label: "Synergy", url: mk("#1e3a8a", "#6d28d9") },
      { id: "warm", label: "Warm", url: mk("#7c2d12", "#b45309") },
      { id: "forest", label: "Forest", url: mk("#064e3b", "#0f766e") },
    ];
  }, []);

  const applyBackground = useCallback(
    async (kind: "none" | "blur" | "vb", url?: string) => {
      try {
        const pub = localParticipant.getTrackPublication(Track.Source.Camera);
        const track = pub?.videoTrack;
        if (!track) { alert("Turn your camera on first."); return; }
        if (kind === "none") {
          await track.stopProcessor();
        } else if (kind === "blur") {
          const { BackgroundBlur } = await import("@livekit/track-processors");
          await track.setProcessor(BackgroundBlur(15));
        } else {
          const { VirtualBackground } = await import("@livekit/track-processors");
          await track.setProcessor(VirtualBackground(url!));
        }
        setBgKind(kind); setBgImage(url ?? null); setShowBgMenu(false);
      } catch (e) {
        console.warn("background unavailable:", e);
        alert("Virtual backgrounds aren't available on this device/browser.");
      }
    },
    [localParticipant],
  );

  const onUploadBg = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) applyBackground("vb", URL.createObjectURL(f));
      e.target.value = "";
    },
    [applyBackground],
  );

  const copyInvite = useCallback(() => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, []);

  const moderate = useCallback(
    async (identity: string, action: "mute" | "remove") => {
      if (action === "remove" && !confirm(`Remove ${identity} from the meeting?`)) return;
      await fetch("/api/moderate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: roomName, identity, action }),
      });
    },
    [roomName],
  );

  const raisedCount = participants.filter((p) => p.attributes?.handRaised === "1").length;

  return (
    <div className="mroot">
      <div className="mstage">
        <GridLayout tracks={tracks} style={{ height: "100%" }}>
          <ParticipantTile />
        </GridLayout>

        {/* floating reactions */}
        <div className="floats">
          {floats.map((f) => (
            <div key={f.id} className="float">
              <span className="femoji">{f.emoji}</span>
              <span className="ffrom">{f.from}</span>
            </div>
          ))}
        </div>

        {/* live captions overlay */}
        {showCaptions && captions.length > 0 && (
          <div className="captions" aria-live="polite">
            {captions.map((c) => (
              <div key={c.id} className="cap-line">
                <span className="cap-name">{c.name}</span>
                <span className="cap-text">{c.text}</span>
              </div>
            ))}
          </div>
        )}

        {/* live poll card (everyone sees it once a host launches one) */}
        {poll && (() => {
          const total = Object.keys(votes).length;
          const tally = poll.options.map((_, i) => Object.values(votes).filter((v) => v === i).length);
          return (
            <div className="pollcard">
              <div className="pollcard-h">
                <BarChart3 size={16} color="var(--accent)" />
                <span className="pollq">{poll.question}</span>
                {(isStaff || poll.closed) && (
                  <button className="mx" onClick={dismissPoll} title="Dismiss">✕</button>
                )}
              </div>
              <div className="pollopts">
                {poll.options.map((opt, i) => {
                  const pct = total ? Math.round((tally[i] / total) * 100) : 0;
                  const voted = myVote !== null || poll.closed;
                  return (
                    <button key={i} className={`pollopt ${myVote === i ? "mine" : ""}`}
                      disabled={voted} onClick={() => castVote(i)}>
                      {voted && <span className="pollbar" style={{ width: `${pct}%` }} />}
                      <span className="polltext">{opt}</span>
                      {voted && <span className="pollpct">{pct}% · {tally[i]}</span>}
                    </button>
                  );
                })}
              </div>
              <div className="pollfoot">
                <span>{total} vote{total === 1 ? "" : "s"}{poll.closed ? " · closed" : ""}</span>
                {isStaff && !poll.closed && <button className="pollclose" onClick={closePoll}>End poll</button>}
              </div>
            </div>
          );
        })()}

        {/* breakout banner: you're in a breakout, or a host broadcast just arrived */}
        {(inBreakout || breakoutMsg) && (
          <div className="bkbanner">
            <span>{breakoutMsg || (inBreakout ? `You're in Breakout ${breakoutIndex}` : "")}</span>
            {inBreakout && (
              <button className="bkreturn" onClick={returnToMain}>Return to main</button>
            )}
          </div>
        )}

        {/* host breakout composer */}
        {showBreakoutForm && (
          <div className="pollform-wrap" onClick={() => setShowBreakoutForm(false)}>
            <div className="pollform" onClick={(e) => e.stopPropagation()}>
              <div className="pollform-h">
                <Boxes size={16} color="var(--accent)" /> Breakout rooms
                <button className="mx" style={{ marginLeft: "auto" }} onClick={() => setShowBreakoutForm(false)}><X size={15} /></button>
              </div>
              <p className="sub" style={{ margin: "0 0 8px" }}>
                Split the {participants.filter((p) => !(p instanceof LocalParticipant) && !(p.identity || "").startsWith("synergy-captions")).length} other participant(s) into rooms. You stay in the main room.
              </p>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="opt">Number of rooms</span>
                <input type="number" min={1} max={10} value={breakoutCount}
                  onChange={(e) => setBreakoutCount(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
                  style={{ width: 70 }} />
              </div>
              <button className="btn primary" style={{ marginTop: 10 }} onClick={() => openBreakouts(breakoutCount)}>
                Open breakouts
              </button>
            </div>
          </div>
        )}

        {/* host poll composer */}
        {showPollForm && (
          <div className="pollform-wrap" onClick={() => setShowPollForm(false)}>
            <div className="pollform" onClick={(e) => e.stopPropagation()}>
              <div className="pollform-h">
                <BarChart3 size={16} color="var(--accent)" /> New poll
                <button className="mx" style={{ marginLeft: "auto" }} onClick={() => setShowPollForm(false)}><X size={15} /></button>
              </div>
              <input className="pollinput" placeholder="Ask a question…" value={pollQ}
                onChange={(e) => setPollQ(e.target.value)} autoFocus />
              {pollOpts.map((o, i) => (
                <div key={i} className="pollrow">
                  <input className="pollinput" placeholder={`Option ${i + 1}`} value={o}
                    onChange={(e) => setPollOpts((p) => p.map((x, j) => (j === i ? e.target.value : x)))} />
                  {pollOpts.length > 2 && (
                    <button className="mx" onClick={() => setPollOpts((p) => p.filter((_, j) => j !== i))}><X size={14} /></button>
                  )}
                </div>
              ))}
              {pollOpts.length < 5 && (
                <button className="polladd" onClick={() => setPollOpts((p) => [...p, ""])}><Plus size={14} /> Add option</button>
              )}
              <button className="btn primary" style={{ marginTop: 8 }} onClick={launchPoll}
                disabled={!pollQ.trim() || pollOpts.filter((o) => o.trim()).length < 2}>
                Launch poll
              </button>
            </div>
          </div>
        )}

        <ConnectionStateToast />
      </div>

      {/* side panels */}
      {showChat && (
        <aside className="mpanel">
          <div className="mpanel-h">Chat<button className="mx" onClick={() => setShowChat(false)}>✕</button></div>
          <Chat style={{ flex: 1 }} />
        </aside>
      )}
      {showPeople && (
        <aside className="mpanel">
          <div className="mpanel-h">
            People ({humans.length})
            <button className="mx" onClick={() => setShowPeople(false)}>✕</button>
          </div>
          <ul className="plist">
            {humans.map((p) => {
              const isLocal = p instanceof LocalParticipant;
              return (
                <li key={p.identity} className="prow">
                  <span className="pavatar">{(p.name || p.identity).slice(0, 1).toUpperCase()}</span>
                  <span className="pname">
                    {p.name || p.identity}{isLocal ? " (you)" : ""}
                    {p.attributes?.handRaised === "1" && <span className="phand"> ✋</span>}
                  </span>
                  {isStaff && !isLocal && (
                    <span className="pacts">
                      <button title="Mute" onClick={() => moderate(p.identity, "mute")}><MicOff size={15} /></button>
                      <button title="Remove" className="pdel" onClick={() => moderate(p.identity, "remove")}><UserX size={15} /></button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {isStaff && <DialIn room={roomName} />}
        </aside>
      )}
      {showTranscript && (
        <aside className="mpanel">
          <div className="mpanel-h">
            Transcript
            <span style={{ display: "flex", gap: 6, marginLeft: "auto", alignItems: "center" }}>
              <button className="tbtn" title="Copy" onClick={copyTranscript} disabled={!transcript.length}>
                {copiedT ? <Check size={14} /> : <FileText size={14} />}
              </button>
              <button className="tbtn" title="Download .txt" onClick={downloadTranscript} disabled={!transcript.length}>
                <Download size={14} />
              </button>
              <button className="mx" onClick={() => setShowTranscript(false)}>✕</button>
            </span>
          </div>
          <div className="tlist" ref={tlistRef}>
            {transcript.length === 0 ? (
              <p className="sub" style={{ padding: 12 }}>
                {transcribing ? "Listening… spoken words will appear here, labeled by speaker." : "Start Transcribe (or CC) to build the live transcript."}
              </p>
            ) : (
              transcript.map((l) => (
                <div key={l.id} className="tline">
                  <span className="tmeta">
                    <span className="tname">{l.name}</span>
                    <span className="ttime">{new Date(l.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>
                  </span>
                  <span className="ttext">{l.text}</span>
                </div>
              ))
            )}
            <div ref={transcriptEnd} />
          </div>
        </aside>
      )}

      {/* control bar */}
      <div className="mbar">
        <div className="mbar-l">
          <span className="mroom">{roomName}</span>
          <button className="mbtn ghost" onClick={copyInvite} title="Copy invite link">
            <Link2 size={16} /> {copied ? "Copied!" : "Invite"}
          </button>
        </div>

        <div className="mbar-c">
          <TrackToggle source={Track.Source.Microphone} showIcon className="mtoggle" />
          <TrackToggle source={Track.Source.Camera} showIcon className="mtoggle" />
          <TrackToggle source={Track.Source.ScreenShare} showIcon className="mtoggle" />

          <button className={`mbtn ${handRaised ? "on" : ""}`} onClick={toggleHand} title="Raise hand">
            <Hand size={18} />
          </button>

          <div className="mreact">
            <button className="mbtn" onClick={() => setShowReactions((s) => !s)} title="React">
              <Smile size={18} />
            </button>
            {showReactions && (
              <div className="mreact-pop">
                {REACTIONS.map((e) => (
                  <button key={e} onClick={() => sendReaction(e)}>{e}</button>
                ))}
              </div>
            )}
          </div>

          <div className="mreact">
            <button className={`mbtn ${bgKind !== "none" ? "on" : ""}`} onClick={() => setShowBgMenu((s) => !s)} title="Background">
              <Sparkles size={18} />
            </button>
            {showBgMenu && (
              <div className="bgmenu">
                <button className={`bgopt ${bgKind === "none" ? "on" : ""}`} onClick={() => applyBackground("none")}>None</button>
                <button className={`bgopt ${bgKind === "blur" ? "on" : ""}`} onClick={() => applyBackground("blur")}>Blur</button>
                <div className="bgthumbs">
                  {bgPresets.map((p) => (
                    <button key={p.id} title={p.label}
                      className={`bgthumb ${bgImage === p.url ? "on" : ""}`}
                      style={{ backgroundImage: `url(${p.url})` }}
                      onClick={() => applyBackground("vb", p.url)} />
                  ))}
                </div>
                <label className="bgopt bgupload">
                  Upload image
                  <input type="file" accept="image/*" onChange={onUploadBg} hidden />
                </label>
              </div>
            )}
          </div>

          {isStaff && (
            <button className={`mbtn ${poll && !poll.closed ? "on" : ""}`} onClick={() => setShowPollForm((s) => !s)}
              title="Launch a poll">
              <BarChart3 size={18} />
            </button>
          )}

          {isStaff && !inBreakout && (
            <button className={`mbtn ${breakoutOpen ? "on" : ""}`}
              onClick={() => (breakoutOpen ? closeBreakouts() : setShowBreakoutForm((s) => !s))}
              title={breakoutOpen ? "Close breakout rooms" : "Create breakout rooms"}>
              <Boxes size={18} />
            </button>
          )}

          {isStaff && (
            <button className={`mbtn ${transcribing ? "on" : ""}`} onClick={toggleTranscribe} disabled={capBusy}
              title={transcribing ? "Stop transcribing (files transcript)" : "Transcribe meeting (silent — records + files transcript)"}>
              <ScrollText size={18} />
            </button>
          )}
          {isStaff && (
            <button className={`mbtn ${captionsOn ? "on" : ""}`} onClick={toggleCaptions} disabled={capBusy}
              title={captionsOn ? "Turn off on-screen captions" : "Show on-screen captions to everyone"}>
              <Captions size={18} /> CC
            </button>
          )}

          {/* once captions are broadcast, everyone can hide/show the overlay for themselves */}
          {captionsOn && !isStaff && (
            <button className={`mbtn ${showCaptions ? "on" : ""}`} onClick={() => setShowCaptions((s) => !s)}
              title={showCaptions ? "Hide captions" : "Show captions"}>
              <Captions size={18} /> CC
            </button>
          )}

          {isStaff && (
            <button className={`mbtn ${recording ? "rec" : ""}`} onClick={toggleRecord} disabled={recBusy}
              title={recording ? "Stop recording" : "Record meeting"}>
              {recording ? <Square size={16} /> : <Circle size={16} />}
              {recording ? "Stop" : "Rec"}
            </button>
          )}

          <DisconnectButton className="mleave"><PhoneOff size={18} /></DisconnectButton>
        </div>

        <div className="mbar-r">
          <button className={`mbtn ghost ${showPeople ? "on" : ""}`} onClick={() => { setShowPeople((s) => !s); setShowChat(false); setShowTranscript(false); }} title="People">
            <Users size={18} />
            <span className="mcount">{humans.length}{raisedCount > 0 ? ` · ✋${raisedCount}` : ""}</span>
          </button>
          <button className={`mbtn ghost ${showTranscript ? "on" : ""}`}
            onClick={() => { setShowTranscript((s) => !s); setShowChat(false); setShowPeople(false); }} title="Transcript">
            <FileText size={18} />
            {transcript.length > 0 && <span className="mcount">{transcript.length}</span>}
          </button>
          <button className={`mbtn ghost ${showChat ? "on" : ""}`} onClick={() => { setShowChat((s) => !s); setShowPeople(false); setShowTranscript(false); }} title="Chat">
            <MessageSquare size={18} />
          </button>
        </div>
      </div>

      <RoomAudioRenderer />
    </div>
  );
}

/** Calls a phone number into the meeting through Synergy Phone, from the host's own number. */
function DialIn({ room }: { room: string }) {
  const [number, setNumber] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form className="dialin" onSubmit={async (e) => {
      e.preventDefault();
      if (!number.trim()) return;
      setBusy(true);
      setMsg("");
      try {
        const r = await fetch("/api/dialout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ room, number }) });
        const d = await r.json().catch(() => ({}));
        if (r.ok) { setMsg("Calling…"); setNumber(""); } else setMsg(d.error || "That didn't work");
      } catch { setMsg("That didn't work"); }
      finally { setBusy(false); }
    }}>
      <div className="dialin-h"><Phone size={14} /> Call a phone into the meeting</div>
      <div className="dialin-row">
        <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="+1 555 123 4567" aria-label="Phone number to call in" />
        <button className="btn primary" disabled={busy || !number.trim()}>Call</button>
      </div>
      {msg && <div className="dialin-msg">{msg}</div>}
    </form>
  );
}
