/**
 * ffmpeg work: reading a video's facts, the poster frame, and the copy every browser plays
 * (H.264/AAC MP4 with the index up front, so playback starts before the whole file arrives).
 *
 * ffmpeg and ffprobe run as separate programs (FFMPEG_PATH, FFPROBE_PATH; default on PATH), with
 * arguments as a list, never through a shell. Jobs run one at a time (STREAM_JOBS raises that),
 * so a burst of uploads queues instead of starving the server.
 */
import { spawn } from "node:child_process";
import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { q } from "./db";
import { filePath, size, workDir } from "./store";

const ffmpeg = () => process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = () => process.env.FFPROBE_PATH || "ffprobe";

type Run = { code: number | null; stdout: string; stderr: string };

/** Runs a program; `onLine` sees stdout line by line (ffmpeg -progress). */
export function run(cmd: string, args: string[], onLine?: (line: string) => void): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let partial = "";
    child.stdout.on("data", (d: Buffer) => {
      const s = d.toString();
      if (!onLine) {
        stdout += s;
        return;
      }
      partial += s;
      const lines = partial.split("\n");
      partial = lines.pop() ?? "";
      for (const l of lines) onLine(l);
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-8000); // only the end says what went wrong
    });
    child.on("error", (e: NodeJS.ErrnoException) =>
      reject(e.code === "ENOENT" ? new Error(`${cmd} is not installed (set FFMPEG_PATH / FFPROBE_PATH)`) : e),
    );
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

export type Probe = {
  duration: number | null;
  width: number | null;
  height: number | null;
  video: string | null;
  audio: string | null;
  /** Clockwise rotation from the container's metadata (phones record sideways). */
  rotation: number;
};

type Stream = { codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] };

/** What ffprobe's JSON says about a file. */
export function readProbe(json: string): Probe {
  const d = JSON.parse(json) as { format?: { duration?: string }; streams?: Stream[] };
  const streams = d.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video" && s.codec_name !== "mjpeg" && s.codec_name !== "png");
  const a = streams.find((s) => s.codec_type === "audio");
  const num = (x: unknown) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : null);
  const rot = Number(v?.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? v?.tags?.rotate ?? 0) || 0;
  const rotation = ((Math.round(-rot / 90) * 90) % 360 + 360) % 360; // display matrix is counter-clockwise
  const sideways = rotation === 90 || rotation === 270;
  return {
    duration: num(d.format?.duration) ?? num(v?.duration),
    width: num(sideways ? v?.height : v?.width),
    height: num(sideways ? v?.width : v?.height),
    video: v?.codec_name ?? null,
    audio: a?.codec_name ?? null,
    rotation,
  };
}

export async function probe(file: string): Promise<Probe> {
  const r = await run(ffprobe(), ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  if (r.code !== 0) throw new Error("This file isn't a video ffmpeg can read");
  return readProbe(r.stdout);
}

/**
 * How to make the playable copy. H.264 (8-bit, 4:2:0 is what nearly everything records) with AAC
 * or no audio only needs its index moved to the front; anything else is re-encoded, at most 1080p.
 */
export function webArgs(p: Probe, src: string, out: string): string[] {
  // Copied H.264 keeps its rotation flag, which browsers honour; a re-encode is turned upright.
  const copyVideo = p.video === "h264";
  const copyAudio = !p.audio || p.audio === "aac";
  const args = ["-y", "-hide_banner", "-nostdin", "-i", src, "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn"];
  if (copyVideo) args.push("-c:v", "copy");
  else {
    args.push(
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
      // Fit inside 1920x1080 either way up, keep even sizes.
      "-vf", "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))',scale=trunc(iw/2)*2:trunc(ih/2)*2",
    );
  }
  if (copyAudio) args.push("-c:a", "copy");
  else args.push("-c:a", "aac", "-b:a", "160k", "-ac", "2");
  args.push("-movflags", "+faststart", "-progress", "pipe:1", "-nostats", out);
  return args;
}

/** Where the poster frame comes from: a tenth of the way in, at most 5 s, so it isn't a black fade-in. */
export function posterAt(duration: number | null): number {
  return duration ? Math.min(5, duration * 0.1) : 0;
}

// ---- the processing queue ---------------------------------------------------------------------

const g = globalThis as unknown as { __streamJobs?: { running: number; queue: (() => Promise<void>)[] } };
const jobs = (g.__streamJobs ??= { running: 0, queue: [] });

function slots(): number {
  const n = Number(process.env.STREAM_JOBS);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function pump() {
  while (jobs.running < slots() && jobs.queue.length) {
    const job = jobs.queue.shift()!;
    jobs.running++;
    job()
      .catch((e) => console.error("[stream] job", e))
      .finally(() => {
        jobs.running--;
        pump();
      });
  }
}

/** Runs `job` when a slot is free; resolves when it is done. */
export function enqueue(job: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    jobs.queue.push(() => job().then(resolve, reject));
    pump();
  });
}

/** The time, in seconds, an ffmpeg -progress line reports, if it is one. */
export function progressSeconds(line: string): number | null {
  const m = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim());
  return m ? Number(m[1]) / 1_000_000 : null;
}

/**
 * Makes a video ready to watch: facts, poster and playable copy. Marks it failed, with a reason a
 * person can read, when ffmpeg can't.
 */
export async function processVideo(id: string, ext: string): Promise<void> {
  const src = filePath(id, "source", ext);
  try {
    const p = await probe(src);
    if (!p.video) throw new Error("This file has no video in it");
    await q(`UPDATE videos SET duration = $2, width = $3, height = $4, progress = 1 WHERE id = $1`, [id, p.duration, p.width, p.height]);

    const poster = filePath(id, "poster");
    await run(ffmpeg(), ["-y", "-hide_banner", "-nostdin", "-ss", String(posterAt(p.duration)), "-i", src, "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "4", poster]);
    if (!(await size(poster))) await run(ffmpeg(), ["-y", "-hide_banner", "-nostdin", "-i", src, "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", poster]);

    const work = await workDir(id, "web");
    const out = path.join(work, "web.mp4");
    let last = 0;
    const r = await run(ffmpeg(), webArgs(p, src, out), (line) => {
      const t = progressSeconds(line);
      if (t === null || !p.duration) return;
      const pct = Math.max(1, Math.min(99, Math.round((t / p.duration) * 100)));
      if (pct >= last + 5) {
        last = pct;
        void q(`UPDATE videos SET progress = $2 WHERE id = $1`, [id, pct]).catch(() => {});
      }
    });
    if (r.code !== 0 || !(await size(out))) {
      console.error(`[stream] ffmpeg failed for ${id}:`, r.stderr.slice(-1500));
      throw new Error("ffmpeg couldn't convert this video for playback");
    }
    // A missing duration (some recordings) comes right once the file is rewritten.
    const after = p.duration ? null : await probe(out).catch(() => null);
    await rename(out, filePath(id, "web"));
    await rm(work, { recursive: true, force: true });
    await q(
      `UPDATE videos SET status = 'ready', progress = 100, error = NULL, duration = COALESCE(duration, $2), modified_at = now() WHERE id = $1`,
      [id, after?.duration ?? null],
    );
  } catch (e) {
    await q(`UPDATE videos SET status = 'failed', error = $2 WHERE id = $1`, [id, (e as Error).message.slice(0, 300)]).catch(() => {});
  }
}

/** Queues processing; never throws (the video's status says how it went). */
export function startProcessing(id: string, ext: string): void {
  void enqueue(() => processVideo(id, ext)).catch(() => {});
}

/** After a restart: anything left half-processed starts again. Once per process. */
const resumed = globalThis as unknown as { __streamResumed?: boolean };
export async function resumeProcessing(): Promise<void> {
  if (resumed.__streamResumed) return;
  resumed.__streamResumed = true;
  const rows = await q<{ id: string; source_ext: string }>(`SELECT id, source_ext FROM videos WHERE status = 'processing' AND held_deleted_at IS NULL`);
  for (const r of rows) startProcessing(r.id, r.source_ext);
}

/**
 * The audio of a video as mono speech-quality MP3 pieces of `seconds` each, for speech to text.
 * Returns the files in order; the caller removes `dir`.
 */
export async function audioPieces(src: string, dir: string, seconds = 30): Promise<string[]> {
  const r = await run(ffmpeg(), [
    "-y", "-hide_banner", "-nostdin", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k",
    "-f", "segment", "-segment_time", String(seconds), "-reset_timestamps", "1", path.join(dir, "%05d.mp3"),
  ]);
  if (r.code !== 0) throw new Error("This video's sound couldn't be read");
  const { readdir } = await import("node:fs/promises");
  return (await readdir(dir)).filter((f) => f.endsWith(".mp3")).sort().map((f) => path.join(dir, f));
}
