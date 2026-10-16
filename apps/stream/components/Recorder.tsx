"use client";
import { Camera, Circle, Monitor, Mic, MicOff, Square, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { clock } from "@/lib/captions";
import type { VideoCard } from "@/lib/videos";
import { upload } from "./client";

type Source = "screen" | "camera";
type Phase = "setup" | "recording" | "review" | "uploading";

/** The best format this browser records: WebM where it can, MP4 on Safari. */
function pickType(): { mime: string; ext: string } {
  const options = [
    { mime: "video/webm;codecs=vp9,opus", ext: "webm" },
    { mime: "video/webm;codecs=vp8,opus", ext: "webm" },
    { mime: "video/webm", ext: "webm" },
    { mime: "video/mp4", ext: "mp4" },
  ];
  return options.find((o) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(o.mime)) ?? { mime: "", ext: "webm" };
}

/** Screen or camera recording in the browser (Stream's recorder); the result uploads like any video. */
export function Recorder() {
  const [source, setSource] = useState<Source>("screen");
  const [mic, setMic] = useState(true);
  const [phase, setPhase] = useState<Phase>("setup");
  const [elapsed, setElapsed] = useState(0);
  const [title, setTitle] = useState("");
  const [result, setResult] = useState<{ blob: Blob; url: string; ext: string } | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const live = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const started = useRef(0);

  const stopTracks = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(() => stopTracks, []);
  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => setElapsed((Date.now() - started.current) / 1000), 500);
    return () => clearInterval(t);
  }, [phase]);

  async function start() {
    setError("");
    try {
      if (!navigator.mediaDevices) throw new Error("This browser can't record here. Recording needs a secure (https) page.");
      const tracks: MediaStreamTrack[] = [];
      if (source === "screen") {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
        tracks.push(...screen.getVideoTracks(), ...screen.getAudioTracks());
        // Stopping the share from the browser's own bar ends the recording.
        screen.getVideoTracks()[0].addEventListener("ended", () => recorder.current?.state === "recording" && recorder.current.stop());
        if (mic) {
          const voice = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).catch(() => null);
          if (voice) tracks.push(...voice.getAudioTracks());
        }
      } else {
        const cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: mic });
        tracks.push(...cam.getTracks());
      }
      const media = new MediaStream(mixAudio(tracks));
      stream.current = media;
      if (live.current) {
        live.current.srcObject = media;
        live.current.muted = true;
        void live.current.play().catch(() => {});
      }
      const type = pickType();
      const rec = new MediaRecorder(media, type.mime ? { mimeType: type.mime, videoBitsPerSecond: 4_000_000 } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stopTracks();
        if (live.current) live.current.srcObject = null;
        const blob = new Blob(chunks, { type: type.mime.split(";")[0] || "video/webm" });
        setResult({ blob, url: URL.createObjectURL(blob), ext: type.ext });
        setTitle(`Recording ${new Date().toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`);
        setPhase("review");
      };
      recorder.current = rec;
      rec.start(1000);
      started.current = Date.now();
      setElapsed(0);
      setPhase("recording");
    } catch (e) {
      stopTracks();
      const err = e as DOMException;
      setError(err.name === "NotAllowedError" ? "Recording was blocked. Allow screen, camera or microphone access and try again." : err.message);
    }
  }

  async function save() {
    if (!result) return;
    setPhase("uploading");
    setError("");
    const name = `${(title.trim() || "Recording").replace(/[\\/:*?"<>|]+/g, " ")}.${result.ext}`;
    try {
      const job = upload<{ video: VideoCard }>(`/api/videos?name=${encodeURIComponent(name)}&origin=recording`, result.blob, setProgress);
      const { video } = await job.done;
      URL.revokeObjectURL(result.url);
      location.href = `/watch/${video.id}`;
    } catch (e) {
      setError((e as Error).message);
      setPhase("review");
    }
  }

  return (
    <main className="recorder">
      <h1>Record a video</h1>
      {phase === "setup" && (
        <div className="recsetup">
          <div className="choices row">
            <button className={`choice${source === "screen" ? " on" : ""}`} onClick={() => setSource("screen")}>
              <Monitor size={28} /> <strong>Screen</strong> <span className="muted small">A tab, a window or your whole screen</span>
            </button>
            <button className={`choice${source === "camera" ? " on" : ""}`} onClick={() => setSource("camera")}>
              <Camera size={28} /> <strong>Camera</strong> <span className="muted small">Yourself, with your webcam</span>
            </button>
          </div>
          <label className="check">
            <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} /> {mic ? <Mic size={15} /> : <MicOff size={15} />} Record my microphone
          </label>
          <button className="btn primary big" onClick={start}>
            <Circle size={16} fill="currentColor" /> Start recording
          </button>
        </div>
      )}
      <div className={`recview${phase === "recording" ? "" : " hidden"}`}>
        <video ref={live} playsInline />
        <div className="row">
          <span className="rec"><Circle size={12} fill="currentColor" /> {clock(elapsed)}</span>
          <button className="btn danger" onClick={() => recorder.current?.stop()}>
            <Square size={14} fill="currentColor" /> Stop
          </button>
        </div>
      </div>
      {(phase === "review" || phase === "uploading") && result && (
        <div className="recreview">
          <video src={result.url} controls playsInline />
          <label>
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </label>
          <div className="row">
            <button
              className="btn"
              disabled={phase === "uploading"}
              onClick={() => {
                URL.revokeObjectURL(result.url);
                setResult(null);
                setPhase("setup");
              }}
            >
              Discard and start again
            </button>
            <span className="grow" />
            {phase === "uploading" && <progress max={1} value={progress} />}
            <button className="btn primary" disabled={phase === "uploading"} onClick={save}>
              <Upload size={15} /> Save to Stream
            </button>
          </div>
        </div>
      )}
      <p className="error" role="alert">{error}</p>
    </main>
  );
}

/**
 * MediaRecorder keeps only one audio track, so the screen's sound and the microphone are mixed
 * into one first.
 */
function mixAudio(tracks: MediaStreamTrack[]): MediaStreamTrack[] {
  const audio = tracks.filter((t) => t.kind === "audio");
  const video = tracks.filter((t) => t.kind === "video");
  if (audio.length <= 1) return tracks;
  const ctx = new AudioContext();
  const out = ctx.createMediaStreamDestination();
  for (const t of audio) ctx.createMediaStreamSource(new MediaStream([t])).connect(out);
  return [...video, ...out.stream.getAudioTracks()];
}
