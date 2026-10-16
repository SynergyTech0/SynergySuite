"use client";

// Audio and video on a slide. In thumbnails it is a still (poster or a play
// badge); in the slide show it is a real player that starts by itself when
// `autoplay` is set; in the editor a selected one gets a player of its own
// (CanvasPlayer), which plays it in place on the slide, as PowerPoint does.
import React, { useEffect, useRef, useState } from "react";
import type { MediaEl } from "@/lib/slides/model";
import { safeMediaSrc, safeSrc } from "@/lib/slides/sanitize";
import { playableHere } from "@/lib/slides/media-client";

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** live: a working player (true), or one that stays silent (a presenter's copy while the audience window plays the sound). */
export function MediaView({ el, live }: { el: MediaEl; live?: boolean | "muted" }) {
  const src = safeMediaSrc(el.src);
  const poster = el.poster ? safeSrc(el.poster) : "";
  const audio = el.kind === "audio";
  // Windows Media and AVI play in PowerPoint, not in browsers: the poster stays
  const unplayable = !playableHere(el.mime, el.kind);
  if (live && src && !unplayable) {
    // clicks and keys on the player must not advance the slide show
    return audio ? (
      <div data-media="audio" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={stop} onPointerDown={stop} onKeyDown={stop}>
        {poster ? <img src={poster} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} /> : <Speaker />}
        <audio src={src} controls muted={live === "muted"} autoPlay={!!el.autoplay} loop={!!el.loop} preload="auto" style={{ position: "absolute", left: "50%", bottom: -44, width: Math.max(260, el.w), transform: "translateX(-50%)" }} />
      </div>
    ) : (
      <video
        data-media="video"
        src={src}
        poster={poster || undefined}
        controls
        playsInline
        muted={live === "muted"}
        autoPlay={!!el.autoplay}
        loop={!!el.loop}
        preload="auto"
        onClick={stop}
        onPointerDown={stop}
        onKeyDown={stop}
        style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000", display: "block" }}
      />
    );
  }
  return (
    <div data-media-still={el.kind} title={unplayable ? "This format plays in PowerPoint but not in a browser" : undefined} style={{ position: "absolute", inset: 0, background: audio ? "transparent" : "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {poster ? <img src={poster} alt="" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: audio ? "contain" : "cover" }} /> : audio ? <Speaker /> : null}
      {!audio && (
        <svg width={Math.min(96, el.w / 3)} height={Math.min(96, el.h / 3)} viewBox="0 0 48 48" style={{ position: "relative", opacity: 0.9 }}>
          <circle cx="24" cy="24" r="22" fill="rgba(0,0,0,.55)" stroke="#fff" strokeWidth="2" />
          <path d="M19 15 L35 24 L19 33 Z" fill="#fff" />
        </svg>
      )}
    </div>
  );
}

function Speaker() {
  return (
    <svg viewBox="0 0 48 48" style={{ width: "70%", height: "70%", maxWidth: 120, maxHeight: 120 }}>
      <path d="M8 18 H16 L27 9 V39 L16 30 H8 Z" fill="#475569" />
      <path d="M32 17 Q37 24 32 31 M36 12 Q45 24 36 36" fill="none" stroke="#475569" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const clock = (t: number) => {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60), sec = Math.floor(t % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
};

/**
 * The editor's player for a selected audio or video object: a video plays in
 * the object's box on the canvas, and a playback bar under it has play/pause,
 * a position slider, 0.25 s back and forward, the time and mute. It stops
 * when the object is deselected.
 */
export function CanvasPlayer({ el, scale }: { el: MediaEl; scale: number }) {
  const src = playableHere(el.mime, el.kind) ? safeMediaSrc(el.src) : "";
  const poster = el.poster ? safeSrc(el.poster) : "";
  const ref = useRef<HTMLMediaElement | null>(null);
  const setRef = (n: HTMLMediaElement | null) => { ref.current = n; };
  const [st, setSt] = useState({ playing: false, t: 0, d: 0, muted: false, started: false });
  useEffect(() => setSt({ playing: false, t: 0, d: 0, muted: false, started: false }), [src]);
  if (!src) return null;
  const m = () => ref.current;
  const sync = () => {
    const v = m();
    if (v) setSt((p) => ({ ...p, t: v.currentTime, d: Number.isFinite(v.duration) ? v.duration : p.d, playing: !v.paused && !v.ended, muted: v.muted }));
  };
  const toggle = () => {
    const v = m();
    if (!v) return;
    if (v.paused || v.ended) {
      setSt((p) => ({ ...p, started: true }));
      void v.play().catch(() => {});
    } else v.pause();
  };
  const seek = (t: number) => {
    const v = m();
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(st.d || v.duration || 0, t));
    setSt((p) => ({ ...p, started: true }));
    sync();
  };
  const events = { onTimeUpdate: sync, onLoadedMetadata: sync, onPlay: sync, onPause: sync, onEnded: sync, onVolumeChange: sync };
  const stopAll = { onPointerDown: stop, onClick: stop, onDoubleClick: stop, onKeyDown: stop };
  const btn = "grid place-items-center w-6 h-6 rounded hover:bg-white/20 text-[11px]";
  const k = 1 / scale;
  return (
    <>
      {el.kind === "video" ? (
        <video
          ref={setRef}
          src={src}
          poster={poster || undefined}
          playsInline
          preload="metadata"
          loop={!!el.loop}
          data-testid="canvas-video"
          {...events}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", background: "#000", pointerEvents: "none", visibility: st.started ? "visible" : "hidden" }}
        />
      ) : (
        <audio ref={setRef} src={src} preload="metadata" loop={!!el.loop} data-testid="canvas-audio" {...events} />
      )}
      <div
        data-testid="media-bar"
        data-playing={st.playing ? "1" : "0"}
        {...stopAll}
        style={{ position: "absolute", left: 0, top: "100%", marginTop: 6 * k, width: Math.max(240, el.w * scale), transform: `scale(${k})`, transformOrigin: "0 0", zIndex: 5, pointerEvents: "auto" }}
        className="flex items-center gap-1 rounded-md bg-slate-800/90 text-white px-1.5 py-1 shadow select-none"
      >
        <button type="button" className={btn} data-testid="media-play" aria-label={st.playing ? "Pause" : "Play"} title={st.playing ? "Pause" : "Play"} onClick={toggle}>{st.playing ? "❚❚" : "▶"}</button>
        <button type="button" className={btn} data-testid="media-back" aria-label="Move back 0.25 seconds" title="Move back 0.25 seconds" onClick={() => seek(st.t - 0.25)}>◂</button>
        <input
          type="range"
          min={0}
          max={st.d || 0}
          step={0.05}
          value={Math.min(st.t, st.d || 0)}
          data-testid="media-seek"
          aria-label="Position"
          className="flex-1 min-w-0 accent-indigo-400 h-1"
          onChange={(e) => seek(Number(e.target.value))}
        />
        <button type="button" className={btn} data-testid="media-fwd" aria-label="Move forward 0.25 seconds" title="Move forward 0.25 seconds" onClick={() => seek(st.t + 0.25)}>▸</button>
        <span className="text-[10px] tabular-nums text-white/80 px-0.5" data-testid="media-time">{clock(st.t)} / {clock(st.d)}</span>
        <button
          type="button"
          className={btn}
          data-testid="media-mute"
          aria-label={st.muted ? "Unmute" : "Mute"}
          title={st.muted ? "Unmute" : "Mute"}
          onClick={() => { const v = m(); if (v) { v.muted = !v.muted; sync(); } }}
        >
          {st.muted ? "🔇" : "🔊"}
        </button>
      </div>
    </>
  );
}
