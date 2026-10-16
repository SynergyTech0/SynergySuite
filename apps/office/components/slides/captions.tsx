"use client";

// Live captions in the slide show: the browser's speech recognition turns
// what the presenter says into subtitles on the slide (and for followers).
import { useEffect, useRef, useState } from "react";
import { CAPTION_LANGS, captionText, readResults, type CaptionSettings } from "@/lib/slides/live";

type Rec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecCtor = new () => Rec;

/** The browser's speech recognition, when it has one. */
export function speechRecognition(): RecCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export type CaptionState = "off" | "listening" | "server" | "unsupported" | "denied" | "error";

/** Is the suite's speech model there for browsers without speech recognition? */
async function serverSpeech(): Promise<boolean> {
  try {
    const r = await fetch("/api/slides/transcribe", { credentials: "same-origin" });
    return r.ok && !!(await r.json()).configured;
  } catch {
    return false;
  }
}

/** A recording format the server's speech model takes. */
const segmentMime = () => ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"].find((m) => (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder?.isTypeSupported?.(m));

/**
 * Captions from the suite's speech model: the microphone is recorded in short
 * pieces (each a complete file) and each piece's text is added as it comes back.
 */
function serverCaptions(lang: string, on: { text: (t: string) => void; state: (s: CaptionState) => void; error: (e: string) => void }): () => void {
  let live = true;
  let stream: MediaStream | null = null;
  let rec: MediaRecorder | null = null;
  let fails = 0;
  const said: string[] = [];
  const piece = () => {
    if (!live || !stream) return;
    const mime = segmentMime();
    const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const parts: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && parts.push(e.data);
    r.onstop = async () => {
      piece(); // the next piece records while this one is turned into text
      const blob = new Blob(parts, { type: (r.mimeType || "audio/webm").split(";")[0] });
      if (blob.size < 2000) return; // silence
      try {
        const res = await fetch(`/api/slides/transcribe?lang=${encodeURIComponent(lang)}&prompt=${encodeURIComponent(said.slice(-2).join(" "))}`, { method: "POST", headers: { "Content-Type": blob.type }, body: blob, credentials: "same-origin" });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
        fails = 0;
        const t = String(j.text || "").trim();
        if (t && live) {
          said.push(t);
          on.text(captionText(said.slice(-3), ""));
        }
      } catch (e) {
        on.error((e as Error).message);
        if (++fails > 3) {
          live = false;
          on.state("error");
        }
      }
    };
    r.start();
    rec = r;
    setTimeout(() => r.state !== "inactive" && r.stop(), 4000);
  };
  navigator.mediaDevices?.getUserMedia({ audio: true }).then(
    (st) => {
      if (!live) return st.getTracks().forEach((t) => t.stop());
      stream = st;
      on.state("server");
      piece();
    },
    () => live && on.state("denied"),
  ) ?? on.state("unsupported");
  return () => {
    live = false;
    if (rec && rec.state !== "inactive") rec.stop();
    stream?.getTracks().forEach((t) => t.stop());
  };
}

/** Subtitles from the microphone while `on`; recognition restarts after pauses in speech. */
export function useCaptions(on: boolean, lang: string): { text: string; state: CaptionState; error: string } {
  const [text, setText] = useState("");
  const [state, setState] = useState<CaptionState>("off");
  const [error, setError] = useState("");
  const finals = useRef<string[]>([]);
  useEffect(() => {
    if (!on) {
      setState("off");
      setText("");
      return;
    }
    const Ctor = speechRecognition();
    if (!Ctor) {
      // no speech recognition in this browser (Firefox): the suite's speech model, when there is one
      let stop: (() => void) | null = null;
      let gone = false;
      void serverSpeech().then((ok) => {
        if (gone) return;
        if (!ok || typeof MediaRecorder === "undefined") return setState("unsupported");
        stop = serverCaptions(lang, { text: setText, state: setState, error: setError });
      });
      return () => {
        gone = true;
        stop?.();
      };
    }
    let live = true;
    let rec: Rec | null = null;
    let restarts = 0;
    finals.current = [];
    const begin = () => {
      if (!live) return;
      rec = new Ctor();
      rec.lang = lang;
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e) => {
        restarts = 0;
        const { finals: done, interim } = readResults(e.results, e.resultIndex);
        if (done.length) finals.current = [...finals.current, ...done].slice(-8);
        setText(captionText(finals.current, interim));
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          live = false;
          setState("denied");
        } else if (e.error !== "no-speech" && e.error !== "aborted") {
          setError(e.error);
          if (++restarts > 5) {
            live = false;
            setState("error");
          }
        }
      };
      // recognition stops after a while or a silence: carry on until captions are turned off
      rec.onend = () => {
        if (live) setTimeout(begin, restarts ? 500 * restarts : 0);
      };
      try {
        rec.start();
        setState("listening");
      } catch {
        setState("error");
      }
    };
    begin();
    return () => {
      live = false;
      if (rec) {
        rec.onend = null;
        rec.onresult = null;
        try {
          rec.abort();
        } catch {
          /* already stopped */
        }
      }
    };
  }, [on, lang]);
  return { text, state, error };
}

const SIZES = { s: 22, m: 30, l: 40 } as const;

/** The subtitle bar over the slide (slide pixels; `scale` is the slide's on-screen scale). */
export function CaptionBar({ text, pos, size }: { text: string; pos: "bottom" | "top"; size: "s" | "m" | "l" }) {
  if (!text) return null;
  return (
    <div data-testid="show-captions" aria-live="polite" style={{ position: "absolute", left: "8%", right: "8%", [pos]: "4%", display: "flex", justifyContent: "center", pointerEvents: "none", zIndex: 6 }}>
      <span style={{ background: "rgba(0,0,0,0.78)", color: "#fff", fontSize: SIZES[size], lineHeight: 1.3, padding: "0.2em 0.6em", borderRadius: 6, fontFamily: "system-ui, sans-serif", textAlign: "center", boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}>{text}</span>
    </div>
  );
}

/** Subtitle settings: language, where they go and how big they are. */
export function CaptionSettingsForm({ value, onChange, state, error }: { value: CaptionSettings; onChange: (v: CaptionSettings) => void; state: CaptionState; error?: string }) {
  return (
    <div className="space-y-2 text-xs text-slate-100 w-60" data-testid="caption-settings">
      <label className="flex items-center justify-between gap-2">Spoken language
        <select className="bg-slate-800 rounded px-1 py-0.5 max-w-[9rem]" value={value.lang} onChange={(e) => onChange({ ...value, lang: e.target.value })} data-testid="caption-lang">
          {CAPTION_LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2">Position
        <select className="bg-slate-800 rounded px-1 py-0.5" value={value.pos} onChange={(e) => onChange({ ...value, pos: e.target.value as "top" | "bottom" })}>
          <option value="bottom">Below the slide content</option>
          <option value="top">Above the slide content</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-2">Size
        <select className="bg-slate-800 rounded px-1 py-0.5" value={value.size} onChange={(e) => onChange({ ...value, size: e.target.value as "s" | "m" | "l" })}>
          <option value="s">Small</option>
          <option value="m">Medium</option>
          <option value="l">Large</option>
        </select>
      </label>
      <p className="text-slate-400" data-testid="caption-state" data-state={state}>
        {state === "unsupported" ? "This browser has no speech recognition and no speech model is configured for the suite. Use a current Chrome, Edge or Safari, or ask an administrator to set AI_SPEECH_MODEL." : state === "server" ? "Listening. Speech is turned into text by the suite's speech model, a few seconds behind." : state === "denied" ? "The microphone (or speech service) is blocked for this site." : state === "error" ? `Captions stopped${error ? ` (${error})` : ""}.` : state === "listening" ? "Listening. Speech is turned into text by your browser, which may use an online speech service." : "Subtitles are off."}
      </p>
    </div>
  );
}
