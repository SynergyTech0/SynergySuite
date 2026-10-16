// Export a presentation as a video, in the browser: each slide is drawn once
// (see raster.ts), held for its time and joined to the next by its transition,
// drawn on a canvas; WebCodecs encodes the frames (VP9/VP8 or AV1 in WebM;
// H.264 or else AV1/VP9 in MP4) and narrations recorded on the slides become
// the sound track (Opus, or AAC in MP4 where the browser has it). Animations
// play as in the slide show: each click step in turn, spread over the slide's
// time, its frames drawn from the laid-out slide with its effects paused at
// each moment.
import { buildSteps, type AnimStep, type MediaEl, type Slide, type Transition } from "./model";

export type VideoFormat = "webm" | "mp4";
/** One click step of a slide's animations: when it starts (ms after the slide is in) and how long it plays. */
export type StepTime = { at: number; dur: number };
export type PlanItem = { index: number; start: number; hold: number; trans?: Transition; transMs: number; steps?: StepTime[] };

/**
 * When a slide's animation steps play within its time: a step that starts
 * by itself plays at once, click steps are spread evenly over the time
 * (at least `minGap` apart), and the slide stays until the last one is done.
 */
export function stepTimes(steps: AnimStep[], hold: number, minGap = 800): { times: StepTime[]; hold: number } {
  const clicks = steps.filter((s, k) => !(k === 0 && s.auto)).length;
  const gap = clicks ? Math.max(minGap, hold / (clicks + 1)) : 0;
  const times: StepTime[] = [];
  let cursor = 0;
  steps.forEach((s, k) => {
    const dur = Math.max(1, ...s.items.map((it) => it.at + (it.anim.effect === "appear" ? 1 : it.anim.dur)));
    const at = k === 0 && s.auto ? 0 : cursor + gap;
    times.push({ at, dur });
    cursor = at + dur;
  });
  return { times, hold: times.length ? Math.max(hold, cursor + (clicks ? gap : 500)) : hold };
}

/**
 * When each slide starts and how long it stays (ms): its "advance after"
 * timing, else as long as its narration (plus a beat), else `secs`. The
 * transition into a slide plays at its start.
 */
export function videoPlan(slides: Slide[], opts: { secs: number; useTimings?: boolean; narration?: Record<string, number>; transitions?: boolean; animations?: boolean }): { items: PlanItem[]; total: number } {
  const items: PlanItem[] = [];
  let t = 0;
  for (const [index, s] of slides.entries()) {
    if (s.hidden) continue;
    const trans = opts.transitions === false || !items.length || !s.trans || s.trans.type === "none" ? undefined : s.trans;
    const transMs = trans ? Math.min(3000, Math.max(100, trans.dur)) : 0;
    const narr = opts.narration?.[s.id];
    const timed = opts.useTimings !== false && s.trans?.advAfter ? s.trans.advAfter : 0;
    let hold = Math.max(500, timed || (narr ? narr + 500 : opts.secs * 1000));
    const steps = opts.animations === false ? [] : buildSteps(s);
    if (steps.length) {
      const st = stepTimes(steps, hold);
      hold = st.hold;
      items.push({ index, start: t, hold, trans, transMs, steps: st.times });
    } else items.push({ index, start: t, hold, trans, transMs });
    t += transMs + hold;
  }
  return { items, total: t };
}

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

/** One frame of the transition from picture `a` to `b` (p from 0 to 1). */
export function drawTransition(g: CanvasRenderingContext2D, a: CanvasImageSource, b: CanvasImageSource, p: number, t: Transition, W: number, H: number) {
  const k = ease(Math.max(0, Math.min(1, p)));
  const d = t.dir || "l";
  const dx = d === "l" ? -1 : d === "r" ? 1 : 0, dy = d === "u" ? -1 : d === "d" ? 1 : 0;
  g.save();
  g.globalAlpha = 1;
  g.drawImage(a, 0, 0, W, H);
  switch (t.type) {
    case "push":
      g.clearRect(0, 0, W, H);
      g.drawImage(a, dx * k * W, dy * k * H, W, H);
      g.drawImage(b, dx * (k - 1) * W, dy * (k - 1) * H, W, H);
      break;
    case "cover":
      g.drawImage(b, dx * (k - 1) * W, dy * (k - 1) * H, W, H);
      break;
    case "wipe": {
      g.beginPath();
      if (d === "l") g.rect(W * (1 - k), 0, W * k, H);
      else if (d === "r") g.rect(0, 0, W * k, H);
      else if (d === "u") g.rect(0, H * (1 - k), W, H * k);
      else g.rect(0, 0, W, H * k);
      g.clip();
      g.drawImage(b, 0, 0, W, H);
      break;
    }
    case "split":
      g.beginPath();
      g.rect((W * (1 - k)) / 2, 0, W * k, H);
      g.clip();
      g.drawImage(b, 0, 0, W, H);
      break;
    case "zoom": {
      const s = 0.3 + 0.7 * k;
      g.globalAlpha = k;
      g.drawImage(b, (W * (1 - s)) / 2, (H * (1 - s)) / 2, W * s, H * s);
      break;
    }
    default:
      // fade, and morph (whose objects cannot be told apart in a picture)
      g.globalAlpha = k;
      g.drawImage(b, 0, 0, W, H);
  }
  g.restore();
}

type Codecs = { video: { codec: string; mux: string }; audio?: { codec: string; mux: string } };

/** The codecs this browser can encode for a format (null when it cannot make one at all). */
export async function pickCodecs(format: VideoFormat, width: number, height: number): Promise<Codecs | null> {
  const VE = (globalThis as { VideoEncoder?: typeof VideoEncoder }).VideoEncoder;
  if (!VE) return null;
  const tryV = async (codec: string) => (await VE.isConfigSupported({ codec, width, height, bitrate: 4_000_000, framerate: 30 }).catch(() => ({ supported: false }))).supported;
  const AE = (globalThis as { AudioEncoder?: typeof AudioEncoder }).AudioEncoder;
  const tryA = async (codec: string) => !!AE && (await AE.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128_000 }).catch(() => ({ supported: false }))).supported;
  const avc = width * height > 1280 * 720 ? "avc1.640028" : "avc1.4d401f";
  const videos: [string, string][] = format === "webm"
    ? [["vp09.00.10.08", "V_VP9"], ["vp8", "V_VP8"], ["av01.0.08M.08", "V_AV1"]]
    : [[avc, "avc"], ["av01.0.08M.08", "av1"], ["vp09.00.10.08", "vp9"]];
  let video: Codecs["video"] | undefined;
  for (const [codec, mux] of videos) if (await tryV(codec)) { video = { codec, mux }; break; }
  if (!video) return null;
  const audios: [string, string][] = format === "webm" ? [["opus", "A_OPUS"]] : [["mp4a.40.2", "aac"], ["opus", "opus"]];
  let audio: Codecs["audio"];
  for (const [codec, mux] of audios) if (await tryA(codec)) { audio = { codec, mux }; break; }
  return { video, audio };
}

/** Narrations on the slides (their recorded audio), decoded: slide id -> samples. */
export async function loadNarrations(slides: Slide[], sampleRate = 48000): Promise<Map<string, AudioBuffer>> {
  const out = new Map<string, AudioBuffer>();
  const AC = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!AC) return out;
  for (const s of slides) {
    const el = s.elements.find((e): e is MediaEl => e.type === "media" && e.kind === "audio" && !!(e.narration || e.autoplay));
    if (!el) continue;
    try {
      const r = await fetch(el.src, { credentials: "same-origin" });
      if (!r.ok) continue;
      const ctx = new AC(2, 1, sampleRate);
      out.set(s.id, await ctx.decodeAudioData(await r.arrayBuffer()));
    } catch {
      // a narration that cannot be decoded here is left out of the sound track
    }
  }
  return out;
}

/** The sound track: each narration placed at its slide's start (after the transition). */
export function mixTrack(plan: PlanItem[], slides: Slide[], clips: Map<string, AudioBuffer>, total: number, sampleRate = 48000): Float32Array[] {
  const len = Math.ceil((total / 1000) * sampleRate);
  const ch = [new Float32Array(len), new Float32Array(len)];
  for (const it of plan) {
    const clip = clips.get(slides[it.index].id);
    if (!clip) continue;
    const at = Math.round(((it.start + it.transMs) / 1000) * sampleRate);
    const ratio = clip.sampleRate / sampleRate;
    const n = Math.min(Math.floor(clip.length / ratio), it.hold * sampleRate / 1000, len - at);
    for (let c = 0; c < 2; c++) {
      const src = clip.getChannelData(Math.min(c, clip.numberOfChannels - 1));
      const dst = ch[c];
      for (let i = 0; i < n; i++) dst[at + i] += src[Math.floor(i * ratio)] || 0;
    }
  }
  return ch;
}

export type VideoJob = {
  format: VideoFormat;
  width: number;
  height: number;
  fps: number;
  /** each slide's picture as it comes in, in plan order */
  frames: CanvasImageSource[];
  /** each slide's picture once its animations have played (defaults to `frames`) */
  ends?: CanvasImageSource[];
  /** a frame of plan item `k`'s animation step `step`, `ms` into it */
  animFrame?: (k: number, step: number, ms: number) => Promise<CanvasImageSource>;
  plan: PlanItem[];
  total: number;
  slides: Slide[];
  audio?: Float32Array[];
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
};

/** Encode the slides into a video file. */
export async function encodeVideo(job: VideoJob): Promise<Blob> {
  const codecs = await pickCodecs(job.format, job.width, job.height);
  if (!codecs) throw new Error(`This browser cannot make ${job.format.toUpperCase()} video. Try WebM in Chrome or Edge.`);
  const { width: W, height: H, fps } = job;
  const withAudio = !!(job.audio && codecs.audio && job.audio[0].some((v) => v !== 0));
  const SR = 48000;
  let muxer: { addVideoChunk(c: EncodedVideoChunk, m?: EncodedVideoChunkMetadata): void; addAudioChunk(c: EncodedAudioChunk, m?: EncodedAudioChunkMetadata): void; finalize(): void };
  let target: { buffer: ArrayBuffer };
  if (job.format === "webm") {
    const m = await import("webm-muxer");
    target = new m.ArrayBufferTarget();
    muxer = new m.Muxer({ target: target as InstanceType<typeof m.ArrayBufferTarget>, video: { codec: codecs.video.mux, width: W, height: H, frameRate: fps }, ...(withAudio ? { audio: { codec: codecs.audio!.mux, numberOfChannels: 2, sampleRate: SR } } : {}) });
  } else {
    const m = await import("mp4-muxer");
    target = new m.ArrayBufferTarget();
    muxer = new m.Muxer({ target: target as InstanceType<typeof m.ArrayBufferTarget>, fastStart: "in-memory", video: { codec: codecs.video.mux as "avc", width: W, height: H, frameRate: fps }, ...(withAudio ? { audio: { codec: codecs.audio!.mux as "aac", numberOfChannels: 2, sampleRate: SR } } : {}) });
  }
  let failed: unknown = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (failed = e) });
  venc.configure({ codec: codecs.video.codec, width: W, height: H, bitrate: W * H * 4, framerate: fps, ...(codecs.video.mux === "avc" ? { avc: { format: "avc" } } : {}) } as VideoEncoderConfig);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d")!;
  const step = 1000 / fps;
  let lastKey = -Infinity;
  const emit = async (ms: number, dur: number) => {
    if (failed) throw failed;
    if (job.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const f = new VideoFrame(canvas, { timestamp: Math.round(ms * 1000), duration: Math.round(dur * 1000) });
    const key = ms - lastKey >= 2000;
    if (key) lastKey = ms;
    venc.encode(f, { keyFrame: key });
    f.close();
    // let the encoder drain so memory stays flat
    while (venc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
  };
  for (const [k, it] of job.plan.entries()) {
    const pic = job.frames[k];
    if (it.trans && k > 0) {
      const prev = job.ends?.[k - 1] || job.frames[k - 1];
      for (let t = 0; t < it.transMs; t += step) {
        drawTransition(g, prev, pic, t / it.transMs, it.trans, W, H);
        await emit(it.start + t, Math.min(step, it.transMs - t));
      }
    }
    const show = (p: CanvasImageSource) => {
      g.clearRect(0, 0, W, H);
      g.drawImage(p, 0, 0, W, H);
    };
    show(pic);
    const from = it.start + it.transMs;
    // a still stretch needs few frames: one a second keeps seeking smooth
    const still = async (a: number, b: number) => {
      for (let t = a; t < b; t += 1000) await emit(from + t, Math.min(1000, b - t));
    };
    let t0 = 0;
    if (it.steps && job.animFrame) {
      for (const [s, st] of it.steps.entries()) {
        await still(t0, st.at);
        for (let t = 0; t < st.dur; t += step) {
          show(await job.animFrame(k, s, t));
          await emit(from + st.at + t, Math.min(step, st.dur - t));
        }
        show(await job.animFrame(k, s, st.dur));
        t0 = st.at + st.dur;
      }
    }
    await still(t0, it.hold);
    job.onProgress?.((k + 1) / job.plan.length * (withAudio ? 0.9 : 1));
  }
  await venc.flush();
  venc.close();

  if (withAudio) {
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (failed = e) });
    aenc.configure({ codec: codecs.audio!.codec, sampleRate: SR, numberOfChannels: 2, bitrate: 128_000 });
    const [L, R] = job.audio!;
    const N = 4800; // 0.1 s per chunk
    for (let i = 0; i < L.length; i += N) {
      const n = Math.min(N, L.length - i);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(i, i + n), 0);
      data.set(R.subarray(i, i + n), n);
      const ad = new AudioData({ format: "f32-planar", sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / SR) * 1e6), data });
      aenc.encode(ad);
      ad.close();
      if (aenc.encodeQueueSize > 16) await new Promise((r) => setTimeout(r, 5));
    }
    await aenc.flush();
    aenc.close();
    job.onProgress?.(1);
  }
  if (failed) throw failed;
  muxer.finalize();
  return new Blob([target.buffer], { type: job.format === "webm" ? "video/webm" : "video/mp4" });
}
