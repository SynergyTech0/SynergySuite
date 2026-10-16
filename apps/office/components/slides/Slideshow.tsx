"use client";

// Slide Show (F5) and Presenter View.
//  - Slide Show: full-screen, one slide at a time, keyboard/click navigation,
//    hidden slides skipped, black/white screen (B/W), Esc to leave.
//  - Presenter View: current slide, next slide, speaker notes, timer and clock
//    for the presenter; "Audience window" opens a second browser window that
//    mirrors the current slide (drag it to the projector and full-screen it).
//  - Pointer tools: laser pointer (Ctrl+L), pen (Ctrl+P), highlighter (Ctrl+I),
//    eraser (E clears the slide's ink), arrow (Ctrl+A / Esc). Ink is kept per
//    slide while presenting and can be kept on the slides afterwards.
//  - Rehearse timings: a timer per slide; the times become "advance after".
//  - Loop until Esc, and "advance after" timings on or off (Set Up Slide Show).
//  - Subtitles (J): live captions from the browser's speech recognition.
//  - Audience link: people with access follow the show on their own screens.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { animStateAt, buildSteps, triggerSteps, type AnimStep, type Box, type Slide, type Transition, type ZoomEl } from "@/lib/slides/model";
import { soundUrl } from "@/lib/slides/anim-sound";
import { morphFrames, morphPairs, zoomRange } from "@/lib/slides/morph";
import { DeckSlides, SlideView, type AnimState, type DeckLook } from "./SlideView";
import { fmtTime } from "@/lib/slides/show";
import { CAPTION_DEFAULTS, defaultCaptionLang, liveInk, parseCaptionSettings, type CaptionSettings, type LiveState } from "@/lib/slides/live";
import { CaptionBar, CaptionSettingsForm, useCaptions } from "./captions";

function useFit(ref: React.RefObject<HTMLElement | null>, W: number, H: number) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const win = el.ownerDocument.defaultView || window;
    const RO = (win as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver || ResizeObserver;
    const update = () => setScale(Math.max(0.05, Math.min(el.clientWidth / W, el.clientHeight / H)));
    update();
    const ro = new RO(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, W, H]);
  return scale;
}

/** `zoom`: a zoom into (or, `out`, back out of) the slide behind the zoom object at `box` */
export type Shown = { slide: Slide; anim?: AnimState; prev?: Slide; trans?: Transition; key: string; zoom?: { box: Box; out?: boolean } };
const ZOOM_MS = 700;

function transStyles(t: Transition | undefined): { cur?: CSSProperties; prev?: CSSProperties } {
  if (!t || t.type === "none") return {};
  const d = `${t.dur}ms`;
  const dir = t.dir || "l";
  const a = (n: string) => ({ animation: `${n} ${d} ease-in-out both` });
  switch (t.type) {
    case "fade": return { cur: a("syn-t-fade") };
    case "zoom": return { cur: a("syn-t-zoom") };
    case "split": return { cur: a("syn-t-split") };
    case "wipe": return { cur: a(`syn-t-wipe-${dir}`) };
    case "cover": return { cur: a(`syn-t-in-${dir}`) };
    case "push": return { cur: a(`syn-t-in-${dir}`), prev: a(`syn-t-out-${dir}`) };
    case "morph": return {}; // per object, see useMorph
  }
  return {};
}

export type InkStroke = { tool: "pen" | "hl"; color: string; pts: { x: number; y: number }[] };
/** `audio`: narration recorded on each slide (Record Slide Show) */
export type ShowResult = { ink: Record<string, InkStroke[]>; times?: Record<string, number>; audio?: Record<string, Blob> };

/** The best format MediaRecorder offers for a narration. */
function narrationMime(): string | undefined {
  const MR = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  // AAC in MP4 first: PowerPoint plays it everywhere (other recordings are converted when kept)
  return ["audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((m) => MR?.isTypeSupported?.(m));
}
type Tool = "none" | "laser" | "pen" | "hl" | "eraser";
type StagePointer = (kind: "down" | "move" | "up" | "leave", p: { x: number; y: number }, e: React.PointerEvent) => void;

/** Ink and the laser dot, drawn in slide coordinates over the slide. */
export function InkLayer({ strokes, live, laser, look }: { strokes: InkStroke[]; live?: InkStroke | null; laser?: { x: number; y: number } | null; look: DeckLook }) {
  const line = (k: InkStroke, i: number | string) => (
    <polyline
      key={i}
      points={k.pts.map((p) => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`).join(" ")}
      fill="none"
      stroke={`#${k.color}`}
      strokeWidth={k.tool === "hl" ? 22 : 4}
      strokeOpacity={k.tool === "hl" ? 0.4 : 1}
      strokeLinecap={k.tool === "hl" ? "square" : "round"}
      strokeLinejoin="round"
    />
  );
  return (
    <svg data-testid="ink-layer" width={look.W} height={look.H} viewBox={`0 0 ${look.W} ${look.H}`} style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5 }}>
      {strokes.map(line)}
      {live && live.pts.length > 1 && line(live, "live")}
      {laser && (
        <g data-testid="laser-dot">
          <circle cx={laser.x} cy={laser.y} r={16} fill="#ff0000" opacity={0.25} />
          <circle cx={laser.x} cy={laser.y} r={7} fill="#ff2020" stroke="#ffffff" strokeWidth={1.5} />
        </g>
      )}
    </svg>
  );
}

export function Fitted({ shown, look, blank, muted, overlay, onStage, cursor }: { shown?: Shown; look: DeckLook; blank?: "black" | "white" | null; muted?: boolean; overlay?: React.ReactNode; onStage?: StagePointer; cursor?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const s = useFit(ref, look.W, look.H);
  const stage = useRef<HTMLDivElement>(null);
  const at = (e: React.PointerEvent) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * look.W, y: ((e.clientY - r.top) / r.height) * look.H };
  };
  const handlers = onStage
    ? {
        onPointerDown: (e: React.PointerEvent) => onStage("down", at(e), e),
        onPointerMove: (e: React.PointerEvent) => onStage("move", at(e), e),
        onPointerUp: (e: React.PointerEvent) => onStage("up", at(e), e),
        onPointerLeave: (e: React.PointerEvent) => onStage("leave", at(e), e),
      }
    : {};
  const zm = shown?.prev ? shown.zoom : undefined;
  const ts = zm ? {} : transStyles(shown?.prev ? shown.trans : undefined);
  const prevRef = useRef<HTMLDivElement>(null);
  const curRef = useRef<HTMLDivElement>(null);
  useMorph(shown, look, prevRef, curRef);
  // zooming in grows the slide out of the zoom object; zooming out shrinks it back into it
  const zoomName = zm ? `syn-zm-${shown!.key.replace(/[^\w-]/g, "")}-${zm.out ? "o" : "i"}` : "";
  const zoomCss = zm
    ? `@keyframes ${zoomName} { from { transform: ${zm.out ? "none" : zoomTf(zm.box, look, s)}; } to { transform: ${zm.out ? zoomTf(zm.box, look, s) : "none"}; } }`
    : "";
  const zoomAnim: CSSProperties | undefined = zm ? { animation: `${zoomName} ${ZOOM_MS}ms ease-in-out both`, transformOrigin: "0 0", zIndex: 1 } : undefined;
  const layer = (sl: Slide, style: CSSProperties | undefined, anim?: AnimState, ref?: React.Ref<HTMLDivElement>) => (
    <div ref={ref} style={{ position: "absolute", inset: 0, ...style }}>
      <div style={{ transform: `scale(${s})`, transformOrigin: "0 0", width: look.W, height: look.H }}>
        <SlideView slide={sl} look={look} anim={anim} muted={muted} />
      </div>
    </div>
  );
  return (
    <div ref={ref} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <div ref={stage} data-testid="show-stage" style={{ width: look.W * s, height: look.H * s, position: "relative", overflow: "hidden", cursor, touchAction: onStage ? "none" : undefined }} {...handlers}>
        {blank ? (
          <div style={{ position: "absolute", inset: 0, background: blank }} />
        ) : shown ? (
          <>
            {zoomCss && <style>{zoomCss}</style>}
            {shown.prev && layer(shown.prev, zm?.out ? zoomAnim : ts.prev, undefined, prevRef)}
            <div key={shown.key} style={{ position: "absolute", inset: 0 }}>
              {layer(shown.slide, zm && !zm.out ? zoomAnim : ts.cur, shown.anim, curRef)}
            </div>
          </>
        ) : null}
        {overlay && !blank && (
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <div style={{ transform: `scale(${s})`, transformOrigin: "0 0", width: look.W, height: look.H, position: "relative" }}>{overlay}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** The transform that puts a full slide layer over a box on the slide (stage pixels at scale `s`). */
function zoomTf(b: Box, look: DeckLook, s: number): string {
  return `translate(${Math.round(b.x * s * 100) / 100}px, ${Math.round(b.y * s * 100) / 100}px) scale(${Math.round((b.w / look.W) * 1e4) / 1e4}, ${Math.round((b.h / look.H) * 1e4) / 1e4})`;
}

/**
 * Morph: objects found on both slides move (and resize and turn) from where
 * they were; everything else on the incoming slide, its background included,
 * fades in over the outgoing one, whose paired objects are hidden.
 */
function useMorph(shown: Shown | undefined, look: DeckLook, prevRef: React.RefObject<HTMLDivElement | null>, curRef: React.RefObject<HTMLDivElement | null>) {
  const prev = shown?.prev, cur = shown?.slide, t = shown?.trans;
  const on = !!prev && !!cur && t?.type === "morph" && !shown?.zoom;
  useLayoutEffect(() => {
    if (!on || !prev || !cur || !t) return;
    const pr = prevRef.current?.querySelector<HTMLElement>(":scope > div > div");
    const cr = curRef.current?.querySelector<HTMLElement>(":scope > div > div");
    if (!pr || !cr || typeof cr.animate !== "function") return;
    const pairs = morphPairs(prev, cur, look.W, look.H);
    const opts: KeyframeAnimationOptions = { duration: t.dur, easing: "ease-in-out", fill: "both" };
    const anims: Animation[] = [];
    const node = (root: HTMLElement, k: string) => root.querySelector<HTMLElement>(`:scope > [data-el="${CSS.escape(k)}"]`);
    const moved = new Set<HTMLElement>();
    for (const p of pairs) {
      const a = node(pr, p.from), b = node(cr, p.to);
      if (a) anims.push(a.animate([{ opacity: 0 }, { opacity: 0 }], opts));
      if (b) {
        moved.add(b);
        anims.push(b.animate(morphFrames(p), opts));
      }
    }
    for (const c of Array.from(cr.children) as HTMLElement[]) if (!moved.has(c) && c.tagName !== "STYLE") anims.push(c.animate([{ opacity: 0 }, { opacity: 1 }], opts));
    return () => anims.forEach((x) => x.cancel());
  }, [on, prev, cur, t, look.W, look.H, prevRef, curRef]);
}

const fmt = (ms: number) => {
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s).padStart(2, "0")}`;
};

type Nav = { pos: number; shown: number; fwd: boolean; prev: number; seq: number; zoom?: { box: Box; out?: boolean } };

export default function Slideshow({
  slides,
  look,
  start,
  mode,
  onExit,
  loop = false,
  useTimings = true,
  rehearse = false,
  record = false,
  deck,
  follow,
}: {
  /** following: publishes where the show is (null when it stops); `link` is the audience view */
  follow?: { link: string; name: string; followers?: number; publish: (s: LiveState | null) => void };
  slides: Slide[];
  /** every slide of the deck (zoom thumbnails), when `slides` is a custom show */
  deck?: Slide[];
  look: DeckLook;
  start: number;
  mode: "show" | "presenter";
  /** `result`: ink drawn during the show and, when rehearsing, each slide's time (ms) */
  onExit: (lastIndex: number, result?: ShowResult) => void;
  /** start again after the last slide (until Esc) */
  loop?: boolean;
  /** advance by the slides' "advance after" timings */
  useTimings?: boolean;
  /** Rehearse Timings: time each slide (its own timings are not used) */
  rehearse?: boolean;
  /** Record Slide Show: timings as when rehearsing, plus narration from the microphone (and ink) */
  record?: boolean;
}) {
  const deckCtx = useMemo(() => ({ slides: deck || slides }), [deck, slides]);
  // Navigation runs over visible slides only; `start` is an index into `slides`.
  const visible = useMemo(() => slides.map((s, i) => ({ s, i })).filter((x) => !x.s.hidden), [slides]);
  // Click steps already revealed on the current slide (animations), and the
  // previous slide while a transition plays.
  const initialShown = useCallback((p: number, fromBack: boolean) => {
    const st = visible[p] ? buildSteps(visible[p].s) : [];
    return fromBack ? st.length : st[0]?.auto ? 1 : 0;
  }, [visible]);
  const [nav, setNav] = useState(() => {
    const k = Math.max(0, visible.findIndex((v) => v.i >= start));
    return { pos: k, shown: initialShown(k, false), fwd: true, prev: -1, seq: 0 } as Nav;
  });
  // zooms being presented: where to come back to, and the last slide of the zoomed range
  const zooms = useRef<{ from: number; shown: number; end: number; start: number; ret: boolean; box: Box }[]>([]);
  const navRef = useRef(nav);
  navRef.current = nav;
  // triggers: each click on a trigger plays the next step of its own sequence (state per visit of the slide)
  const [trig, setTrig] = useState<{ pos: number; seq: number; n: Record<string, number>; last?: string; tick: number }>({ pos: -1, seq: -1, n: {}, tick: 0 });
  useEffect(() => setTrig((t) => ({ pos: nav.pos, seq: -1, n: {}, tick: t.tick + 1 })), [nav.pos]);
  const pos = nav.pos;
  const [blank, setBlank] = useState<"black" | "white" | null>(null);
  const [ended, setEnded] = useState(false);
  const [t0, setT0] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [audience, setAudience] = useState<Window | null>(null);
  const [audienceRoot, setAudienceRoot] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const cur = visible[Math.min(pos, visible.length - 1)];
  const next = visible[pos + 1];

  // ---- pointer tools and ink ----
  const [tool, setTool] = useState<Tool>("none");
  const [penColor, setPenColor] = useState("E81123");
  const [ink, setInk] = useState<Record<string, InkStroke[]>>({});
  const [live, setLive] = useState<InkStroke | null>(null);
  const liveRef = useRef<InkStroke | null>(null);
  const [laser, setLaser] = useState<{ x: number; y: number } | null>(null);
  const curId = cur?.s.id || "";
  const eraseAt = (p: { x: number; y: number }) =>
    setInk((m) => {
      const list = m[curId] || [];
      const keep = list.filter((k) => !k.pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < (k.tool === "hl" ? 18 : 12)));
      return keep.length === list.length ? m : { ...m, [curId]: keep };
    });
  const onStage: StagePointer = (kind, p, e) => {
    if (tool === "laser") {
      setLaser(kind === "leave" ? null : p);
      return;
    }
    if (tool === "eraser") {
      if (kind === "down" || (kind === "move" && e.buttons & 1)) eraseAt(p);
      return;
    }
    if (tool !== "pen" && tool !== "hl") return;
    if (kind === "down") {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      liveRef.current = { tool, color: tool === "hl" ? (penColor === "E81123" ? "FFF100" : penColor) : penColor, pts: [p] };
      setLive(liveRef.current);
    } else if (kind === "move" && liveRef.current) {
      const pts = liveRef.current.pts;
      const last = pts[pts.length - 1];
      if (Math.hypot(last.x - p.x, last.y - p.y) < 1.5) return;
      liveRef.current = { ...liveRef.current, pts: [...pts, p] };
      setLive(liveRef.current);
    } else if ((kind === "up" || kind === "leave") && liveRef.current) {
      const k = liveRef.current;
      liveRef.current = null;
      setLive(null);
      if (k.pts.length > 1) setInk((m) => ({ ...m, [curId]: [...(m[curId] || []), k] }));
    }
  };
  const drawing = tool === "pen" || tool === "hl" || tool === "eraser";
  // ---- subtitles ----
  const [ccOn, setCcOn] = useState(false);
  const [ccSet, setCcSet] = useState<CaptionSettings>(() => {
    try {
      const raw = localStorage.getItem("slides.captions");
      if (raw) return parseCaptionSettings(JSON.parse(raw));
    } catch {
      /* no storage */
    }
    return { ...CAPTION_DEFAULTS, lang: defaultCaptionLang(typeof navigator !== "undefined" ? navigator.language : undefined) };
  });
  const saveCc = (v: CaptionSettings) => {
    setCcSet(v);
    try {
      localStorage.setItem("slides.captions", JSON.stringify(v));
    } catch {
      /* no storage */
    }
  };
  const cc = useCaptions(ccOn, ccSet.lang);
  const [panel, setPanel] = useState<null | "cc" | "link">(null);
  const overlay = (
    <>
      <InkLayer strokes={ink[curId] || []} live={live} laser={tool === "laser" ? laser : null} look={look} />
      {ccOn && <CaptionBar text={cc.text} pos={ccSet.pos} size={ccSet.size} />}
    </>
  );
  const stageCursor = tool === "laser" ? "none" : tool === "pen" || tool === "hl" ? "crosshair" : tool === "eraser" ? "cell" : undefined;

  // ---- rehearse timings ----
  const times = useRef<Record<string, number>>({});
  const seg = useRef<{ id: string; start: number | null }>({ id: curId, start: Date.now() });
  const [paused, setPaused] = useState(false);
  const flush = () => {
    const sg = seg.current;
    if (sg.start !== null && sg.id) times.current[sg.id] = (times.current[sg.id] || 0) + (Date.now() - sg.start);
    if (sg.start !== null) sg.start = Date.now();
  };
  useEffect(() => {
    if (!rehearse || seg.current.id === curId) return;
    flush();
    seg.current = { id: curId, start: paused ? null : Date.now() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curId, rehearse]);
  const togglePause = () => {
    flush();
    if (paused) seg.current.start = Date.now();
    else seg.current.start = null;
    const r = clip.current?.rec;
    if (r && r.state === "recording" && !paused) r.pause();
    else if (r && r.state === "paused" && paused) r.resume();
    setPaused(!paused);
  };
  const repeatSlide = () => {
    times.current[curId] = 0;
    seg.current = { id: curId, start: paused ? null : Date.now() };
    if (record) startClip(curId);
  };

  // ---- narration: one recording per slide from the microphone ----
  const mic = useRef<MediaStream | null>(null);
  const clip = useRef<{ id: string; rec: MediaRecorder; parts: Blob[] } | null>(null);
  const audio = useRef<Record<string, Blob>>({});
  const [micState, setMicState] = useState<"off" | "asking" | "on" | "denied">(record ? "asking" : "off");
  const stopClip = (): Promise<void> =>
    new Promise((res) => {
      const c = clip.current;
      clip.current = null;
      if (!c || c.rec.state === "inactive") return res();
      c.rec.onstop = () => {
        const b = new Blob(c.parts, { type: (c.rec.mimeType || "audio/webm").split(";")[0] });
        if (b.size) audio.current[c.id] = b;
        res();
      };
      c.rec.stop();
    });
  const startClip = (id: string) => {
    const old = clip.current;
    if (old && old.id === id) {
      // repeating the slide: drop what was said so far
      old.rec.ondataavailable = null;
      old.rec.onstop = null;
      if (old.rec.state !== "inactive") old.rec.stop();
      clip.current = null;
      delete audio.current[id];
    } else void stopClip();
    if (!mic.current || !id) return;
    const mime = narrationMime();
    const rec = new MediaRecorder(mic.current, mime ? { mimeType: mime } : undefined);
    const c = { id, rec, parts: [] as Blob[] };
    rec.ondataavailable = (e) => e.data.size && c.parts.push(e.data);
    rec.start(1000);
    if (paused) rec.pause();
    clip.current = c;
  };
  useEffect(() => {
    if (!record) return;
    let live = true;
    navigator.mediaDevices?.getUserMedia({ audio: true }).then(
      (st) => {
        if (!live) return st.getTracks().forEach((t) => t.stop());
        mic.current = st;
        setMicState("on");
      },
      () => live && setMicState("denied"),
    ) ?? setMicState("denied");
    return () => {
      live = false;
      clip.current?.rec.state !== "inactive" && clip.current?.rec.stop();
      mic.current?.getTracks().forEach((t) => t.stop());
      mic.current = null;
    };
  }, [record]);
  // a new clip for each slide, once the microphone is on
  useEffect(() => {
    if (micState === "on" && !ended) startClip(curId);
    if (ended) void stopClip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curId, micState, ended]);
  const slideTime = () => (times.current[curId] || 0) + (seg.current.id === curId && seg.current.start !== null ? Date.now() - seg.current.start : 0);
  const totalTime = () => Object.entries(times.current).reduce((a, [id, v]) => a + (id === curId ? 0 : v), 0) + slideTime();

  // ---- audience link: publish where the show is while sharing ----
  const [sharing, setSharing] = useState<number | null>(null); // when sharing started
  const followRef = useRef(follow);
  followRef.current = follow;
  useEffect(() => {
    if (!sharing || !followRef.current) return;
    const z = nav.prev >= 0 ? nav.zoom : undefined;
    followRef.current.publish({
      v: 1,
      since: sharing,
      name: followRef.current.name,
      sid: curId,
      step: nav.shown,
      fwd: nav.fwd,
      seq: nav.seq,
      ...(blank ? { blank } : {}),
      ...(ended ? { ended: true } : {}),
      ...(z ? { zoom: z } : {}),
      ...(ink[curId]?.length ? { ink: liveInk(ink[curId]) } : {}),
      ...(ccOn && cc.text ? { cap: cc.text } : {}),
      ...(trig.pos === nav.pos && Object.keys(trig.n).length ? { trig: trig.n } : {}),
      ...(trig.pos === nav.pos && trig.last && trig.seq === nav.seq ? { tlast: trig.last } : {}),
    });
  }, [sharing, curId, nav.shown, nav.fwd, nav.seq, nav.prev, nav.zoom, blank, ended, ink, ccOn, cc.text, trig, nav.pos]);
  useEffect(() => {
    if (!sharing) return;
    return () => followRef.current?.publish(null);
  }, [sharing]);
  const [copied, setCopied] = useState(false);
  const linkPanel = follow && (
    <div data-testid="follow-panel" className="space-y-2 text-xs text-slate-100 w-72">
      {sharing ? (
        <>
          <div className="text-slate-300">People with access to this presentation can follow along at:</div>
          <input readOnly data-testid="follow-link" className="w-full bg-slate-800 rounded px-1.5 py-1 font-mono text-[11px]" value={follow.link} onFocus={(e) => e.currentTarget.select()} />
          <div className="text-slate-400" data-testid="follow-count">{follow.followers ? `${follow.followers} following` : "No one is following yet."}</div>
          <div className="flex gap-2">
            <button className="rounded px-2 py-1 bg-white/15 hover:bg-white/25" onClick={() => navigator.clipboard?.writeText(follow.link).then(() => setCopied(true), () => {})}>{copied ? "Copied" : "Copy link"}</button>
            <button data-testid="follow-stop" className="rounded px-2 py-1 bg-red-500/70 hover:bg-red-500" onClick={() => setSharing(null)}>Stop sharing</button>
          </div>
        </>
      ) : (
        <>
          <div className="text-slate-300">Share an audience link: viewers see the slide you are on, your ink and subtitles, in their own browser.</div>
          <button data-testid="follow-start" className="rounded px-2 py-1 bg-indigo-500 hover:bg-indigo-400" onClick={() => setSharing(Date.now())}>Start sharing</button>
        </>
      )}
    </div>
  );

  const exit = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    audience?.close();
    if (rehearse) flush();
    const hasInk = Object.values(ink).some((l) => l.length);
    const done = () => {
      const narr = Object.keys(audio.current).length ? { audio: { ...audio.current } } : {};
      onExit(cur?.i ?? start, hasInk || rehearse || narr.audio ? { ink, ...(rehearse ? { times: { ...times.current } } : {}), ...narr } : undefined);
    };
    if (record) void stopClip().then(done);
    else done();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience, cur, onExit, start, ink, rehearse, record]);

  const jump = useCallback((p: number, fromBack = false) => {
    setEnded(false);
    setNav((n) => ({ pos: p, shown: initialShown(p, fromBack), fwd: !fromBack, prev: fromBack ? -1 : n.pos, seq: n.seq + 1 }));
  }, [initialShown]);

  const go = useCallback(
    (d: number) => {
      setBlank(null);
      if (ended) {
        if (d < 0) setEnded(false);
        else exit();
        return;
      }
      const n = navRef.current;
      const st = visible[n.pos] ? buildSteps(visible[n.pos].s) : [];
      const z = zooms.current[zooms.current.length - 1];
      // the end (or, going back, the start) of a zoomed slide or section: back to the zoom slide
      if (z && ((d > 0 && n.shown >= st.length && n.pos >= z.end) || (d < 0 && n.shown <= (st[0]?.auto ? 1 : 0) && n.pos <= z.start))) {
        zooms.current.pop();
        if (z.ret || d < 0) {
          setEnded(false);
          setNav({ pos: z.from, shown: z.shown, fwd: false, prev: n.pos, seq: n.seq + 1, zoom: { box: z.box, out: true } });
          return;
        }
      }
      if (d > 0) {
        if (n.shown < st.length) setNav({ ...n, shown: n.shown + 1, fwd: true, prev: -1, seq: n.seq + 1, zoom: undefined });
        else if (n.pos + 1 >= visible.length) {
          if (loop && !rehearse) jump(0);
          else setEnded(true);
        }
        else jump(n.pos + 1);
      } else {
        const min = st[0]?.auto ? 1 : 0;
        if (n.shown > min) setNav({ ...n, shown: n.shown - 1, fwd: false, prev: -1, seq: n.seq + 1, zoom: undefined });
        else if (n.pos > 0) jump(n.pos - 1, true);
      }
    },
    [ended, exit, visible, jump, loop, rehearse],
  );

  // What the current slide shows: hidden (not yet built) targets and the step to play now.
  const steps = useMemo(() => (cur ? buildSteps(cur.s) : []), [cur]);
  const tsteps = useMemo(() => (cur ? triggerSteps(cur.s) : new Map<string, AnimStep[]>()), [cur]);
  const trigNow = trig.pos === nav.pos ? trig : { pos: nav.pos, seq: -1, n: {} as Record<string, number>, last: undefined, tick: trig.tick };
  const anim: AnimState = useMemo(
    () => animStateAt(steps, nav.shown, nav.fwd, [...tsteps].map(([k, st]) => ({ steps: st, shown: trigNow.n[k] || 0, play: trigNow.last === k && trigNow.seq === nav.seq }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [steps, nav.shown, nav.fwd, nav.seq, tsteps, trig],
  );
  /** A click on a trigger: its sequence's next step (after the last one, it starts again). */
  const playTrigger = (t: HTMLElement | null): boolean => {
    const host = t?.closest?.<HTMLElement>("[data-anim]");
    const key = host?.dataset.anim?.replace(/#\d+$/, "");
    const st = key ? tsteps.get(key) : undefined;
    if (!key || !st?.length) return false;
    const seq = navRef.current.seq, pos = navRef.current.pos;
    const done = (trig.pos === pos ? trig.n[key] || 0 : 0) >= st.length;
    const step = (n: number, play: boolean) => setTrig((b) => {
      const base = b.pos === pos ? b : { pos, seq, n: {}, tick: b.tick };
      return { ...base, n: { ...base.n, [key]: n }, last: play ? key : undefined, seq, tick: base.tick + 1 };
    });
    if (done) {
      // start over: back to before the first step, then play it
      step(0, false);
      setTimeout(() => step(1, true), 30);
    } else step((trig.pos === pos ? trig.n[key] || 0 : 0) + 1, true);
    return true;
  };
  // animation sounds: each effect's sound starts with it (the step just clicked, on the slide or on a trigger)
  const playSounds = (st: AnimStep | undefined) => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const it of st?.items || []) {
      const snd = it.anim.sound;
      if (snd) timers.push(setTimeout(() => { try { void new Audio(soundUrl(snd.src)).play().catch(() => {}); } catch { /* no audio here */ } }, it.at));
    }
    return () => timers.forEach(clearTimeout);
  };
  useEffect(() => {
    if (nav.fwd && nav.shown > 0 && !ended) return playSounds(steps[nav.shown - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.seq]);
  useEffect(() => {
    if (trig.last && trig.pos === nav.pos) return playSounds(tsteps.get(trig.last)?.[(trig.n[trig.last] || 0) - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trig.tick]);
  const trans = cur?.s.trans;
  const prevSlide = nav.prev >= 0 && ((trans && trans.type !== "none") || nav.zoom) ? visible[nav.prev]?.s : undefined;
  const shown: Shown | undefined = cur ? { slide: cur.s, anim, prev: prevSlide, trans, key: cur.s.id, ...(nav.zoom ? { zoom: nav.zoom } : {}) } : undefined;

  // drop the outgoing slide once the transition is over
  useEffect(() => {
    if (nav.prev < 0) return;
    const t = setTimeout(() => setNav((n) => (n.seq === nav.seq ? { ...n, prev: -1, zoom: undefined } : n)), (nav.zoom ? ZOOM_MS : trans?.dur || 0) + 60);
    return () => clearTimeout(t);
  }, [nav.prev, nav.seq, trans?.dur, nav.zoom]);
  // "advance after" timing
  useEffect(() => {
    if (ended || !trans?.advAfter || !useTimings || rehearse) return;
    const t = setTimeout(() => go(1), trans.advAfter);
    return () => clearTimeout(t);
  }, [nav.seq, ended, trans?.advAfter, go, useTimings, rehearse]);
  /** A click on a zoom: present its slide or section. */
  const zoomInto = (t: HTMLElement | null): boolean => {
    const host = t?.closest?.<HTMLElement>("[data-zoom-target]")?.closest<HTMLElement>("[data-el]");
    const el = host && cur?.s.elements.find((x): x is ZoomEl => x.id === host.dataset.el && x.type === "zoom");
    if (!el) return false;
    const r = zoomRange(slides, visible.map((v) => v.i), el.target, el.kind);
    if (!r) return false;
    const n = navRef.current;
    zooms.current.push({ from: n.pos, shown: n.shown, start: r.start, end: r.end, ret: !!el.ret, box: { x: el.x, y: el.y, w: el.w, h: el.h } });
    setBlank(null);
    setEnded(false);
    setNav({ pos: r.start, shown: initialShown(r.start, false), fwd: true, prev: n.pos, seq: n.seq + 1, zoom: { box: { x: el.x, y: el.y, w: el.w, h: el.h } } });
    return true;
  };
  const clickAdvance = (e?: React.MouseEvent) => {
    if ((e?.target as HTMLElement | null)?.closest?.("a[href]")) return; // a hyperlink opens instead of advancing
    if (!drawing && !ended && zoomInto(e?.target as HTMLElement | null)) return;
    if (!drawing && !ended && playTrigger(e?.target as HTMLElement | null)) return;
    if (drawing && !ended) return; // pen, highlighter and eraser clicks draw
    if (trans?.advClick === false && !ended) return;
    go(1);
  };

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const k = e.key;
      const mod = e.ctrlKey || e.metaKey;
      if (k === "Escape") {
        if (tool !== "none") return setTool("none");
        return exit();
      }
      if (mod && ["l", "p", "i", "a", "e"].includes(k.toLowerCase())) {
        e.preventDefault();
        const t = ({ l: "laser", p: "pen", i: "hl", a: "none", e: "eraser" } as const)[k.toLowerCase() as "l" | "p" | "i" | "a" | "e"];
        setTool((cur) => (cur === t ? "none" : t));
        return;
      }
      if ((k === "j" || k === "J") && !mod) {
        setCcOn((v) => !v);
        return;
      }
      if ((k === "e" || k === "E") && !mod) {
        setInk((m) => ({ ...m, [curId]: [] }));
        return;
      }
      if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || k === " " || k === "Enter" || k === "n" || k === "N") {
        e.preventDefault();
        go(1);
      } else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp" || k === "Backspace" || k === "p" || k === "P") {
        e.preventDefault();
        go(-1);
      } else if (k === "Home") jump(0);
      else if (k === "End") jump(visible.length - 1); else if (k === "b" || k === "B" || k === ".") setBlank((b) => (b === "black" ? null : "black"));
      else if (k === "w" || k === "W" || k === ",") setBlank((b) => (b === "white" ? null : "white"));
    },
    [exit, go, jump, visible.length, tool, curId],
  );

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);
  useEffect(() => {
    if (!audience) return;
    audience.addEventListener("keydown", onKey);
    return () => audience.removeEventListener("keydown", onKey);
  }, [audience, onKey]);

  useEffect(() => {
    if (mode === "show") rootRef.current?.requestFullscreen?.().catch(() => {});
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [mode]);

  useEffect(() => () => audience?.close(), [audience]);

  const openAudience = () => {
    const w = window.open("", "synergy-audience", "width=960,height=600");
    if (!w) return alert("Allow pop-ups to open the audience window.");
    w.document.title = "Slide Show";
    w.document.body.innerHTML = "";
    w.document.body.style.cssText = "margin:0;background:#000;overflow:hidden";
    // carry our stylesheets over so slide text renders identically
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => w.document.head.appendChild(n.cloneNode(true)));
    const root = w.document.createElement("div");
    root.style.cssText = "position:fixed;inset:0;background:#000";
    root.ondblclick = () => root.requestFullscreen?.();
    w.document.body.appendChild(root);
    w.addEventListener("beforeunload", () => {
      setAudience(null);
      setAudienceRoot(null);
    });
    setAudience(w);
    setAudienceRoot(root);
  };

  const endScreen = (
    <div style={{ position: "absolute", inset: 0, background: "#000", color: "#cbd5e1", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 24, fontSize: 14 }}>
      End of slide show, click to exit.
    </div>
  );

  if (!visible.length) {
    return (
      <div className="fixed inset-0 z-[100] bg-black text-slate-300 flex items-center justify-center" onClick={exit}>
        All slides are hidden. Click to exit.
      </div>
    );
  }

  const toolBtn = (t: Tool, label: string, title: string) => (
    <button data-testid={`show-tool-${t}`} title={title} className={`rounded px-2 py-1 text-xs ${tool === t ? "bg-white/40 text-white" : "text-white/80 bg-white/10 hover:bg-white/20"}`} onClick={() => setTool((c) => (c === t ? "none" : t))}>{label}</button>
  );
  const tools = (
    <>
      {toolBtn("laser", "● Laser", "Laser pointer (Ctrl+L)")}
      {toolBtn("pen", "✎ Pen", "Pen (Ctrl+P)")}
      {toolBtn("hl", "▮ Highlighter", "Highlighter (Ctrl+I)")}
      {toolBtn("eraser", "⌫ Eraser", "Eraser: click strokes to remove them (E clears the slide)")}
      {(tool === "pen" || tool === "hl") && ["E81123", "0078D4", "107C10", "FFF100", "000000", "FFFFFF"].map((c) => (
        <button key={c} title={`#${c}`} data-testid={`ink-color-${c}`} className={`w-5 h-5 rounded-full border ${penColor === c ? "border-white ring-2 ring-white/60" : "border-white/40"}`} style={{ background: `#${c}` }} onClick={() => setPenColor(c)} />
      ))}
    </>
  );
  const liveBtns = (cls: string, on: string) => (
    <>
      <button data-testid="show-cc" title="Subtitles (J)" className={`${cls} ${ccOn ? on : ""}`} onClick={() => setCcOn((v) => !v)}>CC</button>
      <button data-testid="show-cc-settings" title="Subtitle settings" className={cls} onClick={() => setPanel((p) => (p === "cc" ? null : "cc"))}>⚙</button>
      {follow && <button data-testid="show-follow" title="Audience link" className={`${cls} ${sharing ? on : ""}`} onClick={() => setPanel((p) => (p === "link" ? null : "link"))}>{sharing ? "● Sharing" : "Audience link"}</button>}
    </>
  );
  const livePanel = panel && (
    <div className="rounded-lg bg-slate-900/95 border border-white/10 p-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
      {panel === "cc" ? <CaptionSettingsForm value={ccSet} onChange={saveCc} state={cc.state} error={cc.error} /> : linkPanel}
    </div>
  );
  const rehearsal = rehearse && !ended && (
    <div data-testid="rehearse-bar" className="absolute top-3 left-3 z-10 flex items-center gap-2 rounded-lg bg-slate-800/90 text-white px-3 py-1.5 text-sm shadow" onClick={(e) => e.stopPropagation()}>
      <span className="text-xs text-slate-300" data-testid="record-state" data-mic={micState}>
        {record ? (micState === "on" ? <><span className="text-red-400">●</span> Recording narration</> : micState === "asking" ? "Waiting for the microphone…" : "Recording (no microphone)") : "Recording"}
      </span>
      <button data-testid="rehearse-next" className="rounded px-2 py-0.5 bg-white/10 hover:bg-white/20" title="Next" onClick={() => go(1)}>→</button>
      <button data-testid="rehearse-pause" className="rounded px-2 py-0.5 bg-white/10 hover:bg-white/20" title={paused ? "Resume" : "Pause"} onClick={togglePause}>{paused ? "▶" : "⏸"}</button>
      <span data-testid="rehearse-slide" className="tabular-nums w-12 text-center">{fmtTime(slideTime())}</span>
      <button className="rounded px-2 py-0.5 bg-white/10 hover:bg-white/20" title="Repeat this slide" onClick={repeatSlide}>↺</button>
      <span data-testid="rehearse-total" className="tabular-nums text-slate-300">{fmtTime(totalTime())}</span>
    </div>
  );

  if (mode === "show") {
    return (
      <DeckSlides.Provider value={deckCtx}>
      <div ref={rootRef} data-testid="slideshow" data-tool={tool} className="fixed inset-0 z-[100] bg-black select-none" onClick={clickAdvance} onContextMenu={(e) => { e.preventDefault(); if (tool === "none") go(-1); else setTool("none"); }}>
        {ended ? endScreen : <Fitted shown={shown} look={look} blank={blank} overlay={overlay} onStage={onStage} cursor={stageCursor} />}
        {rehearsal}
        <div className={`absolute bottom-3 left-3 flex items-center gap-1 transition ${tool !== "none" ? "opacity-70" : "opacity-0"} hover:opacity-100`} data-testid="show-controls" onClick={(e) => e.stopPropagation()}>
          <button className="text-white/80 bg-white/10 hover:bg-white/20 rounded px-2 py-1 text-xs" onClick={() => go(-1)}>‹</button>
          <button className="text-white/80 bg-white/10 hover:bg-white/20 rounded px-2 py-1 text-xs" onClick={() => go(1)}>›</button>
          <span className="text-white/60 text-xs px-2 py-1">{pos + 1} / {visible.length}</span>
          {tools}
          {liveBtns("text-white/80 bg-white/10 hover:bg-white/20 rounded px-2 py-1 text-xs", "!bg-white/40 !text-white")}
          <button className="text-white/80 bg-white/10 hover:bg-white/20 rounded px-2 py-1 text-xs" onClick={exit}>End show</button>
        </div>
        {livePanel && <div className="absolute bottom-12 left-3" onClick={(e) => e.stopPropagation()}>{livePanel}</div>}
      </div>
      </DeckSlides.Provider>
    );
  }

  // Presenter view
  return (
    <DeckSlides.Provider value={deckCtx}>
    <div data-testid="presenter" className="fixed inset-0 z-[100] bg-slate-900 text-slate-100 flex flex-col">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/10 text-sm">
        <span className="font-semibold">Presenter view</span>
        <span className="tabular-nums text-slate-300" title="Elapsed">⏱ {fmt(now - t0)}</span>
        <button className="text-xs text-slate-400 hover:text-white" onClick={() => setT0(Date.now())}>Reset timer</button>
        <span className="tabular-nums text-slate-400 ml-2">{new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        <div className="ml-auto flex items-center gap-2 relative">
          {liveBtns("text-xs rounded px-2.5 py-1 bg-white/10 hover:bg-white/20", "!bg-indigo-500 text-white")}
          {livePanel && <div className="absolute right-0 top-9 z-10">{livePanel}</div>}
          <button className="text-xs rounded px-2.5 py-1 bg-white/10 hover:bg-white/20" onClick={audience ? () => audience.focus() : openAudience}>
            {audience ? "Audience window open" : "Open audience window"}
          </button>
          <button className="text-xs rounded px-2.5 py-1 bg-white/10 hover:bg-white/20" onClick={() => setBlank((b) => (b === "black" ? null : "black"))}>{blank === "black" ? "Unblack" : "Black screen"}</button>
          <button className="text-xs rounded px-2.5 py-1 bg-red-500/80 hover:bg-red-500" onClick={exit}>End show</button>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex gap-4 p-4">
        <div className="flex-[3] min-w-0 flex flex-col gap-2">
          <div className="relative flex-1 min-h-0 bg-black rounded" onClick={clickAdvance}>
            {ended ? endScreen : <Fitted shown={shown} look={look} blank={blank} muted={!!audience} overlay={overlay} onStage={onStage} cursor={stageCursor} />}
          </div>
          <div className="flex items-center justify-center gap-1" data-testid="presenter-tools">{tools}</div>
          <div className="flex items-center justify-center gap-3 text-sm">
            <button className="rounded-full w-9 h-9 bg-white/10 hover:bg-white/20" onClick={() => go(-1)} aria-label="Previous slide">‹</button>
            <span className="tabular-nums" data-testid="presenter-counter">Slide {pos + 1} of {visible.length}</span>
            <button className="rounded-full w-9 h-9 bg-white/10 hover:bg-white/20" onClick={() => go(1)} aria-label="Next slide">›</button>
          </div>
        </div>
        <div className="flex-[2] min-w-0 flex flex-col gap-3">
          <div className="text-xs uppercase tracking-wide text-slate-400">Next</div>
          <div className="relative bg-black rounded" style={{ aspectRatio: `${look.W} / ${look.H}` }}>
            {next ? <Fitted shown={{ slide: next.s, key: next.s.id }} look={look} /> : <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">End of slide show</div>}
          </div>
          <div className="text-xs uppercase tracking-wide text-slate-400">Notes</div>
          <div data-testid="presenter-notes" className="flex-1 min-h-0 overflow-y-auto whitespace-pre-wrap text-lg leading-relaxed bg-white/5 rounded p-3">
            {cur?.s.notes || <span className="text-slate-500">No notes for this slide.</span>}
          </div>
        </div>
      </div>
      {audienceRoot &&
        createPortal(ended ? endScreen : <Fitted shown={shown} look={look} blank={blank} overlay={overlay} />, audienceRoot)}
    </div>
    </DeckSlides.Provider>
  );
}
