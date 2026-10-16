/**
 * Captions and transcripts. Stream keeps captions as WebVTT (what <track> plays); SubRip files
 * are converted on upload. The transcript people search and read is the captions' text.
 * No Node imports: the watch page uses these too.
 */

export type Cue = { start: number; end: number; text: string };

export const MAX_CAPTIONS = 2 * 1024 * 1024;

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function seconds(t: string): number | null {
  const m = TIME.exec(t);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;
}

/** 75.5 → "00:01:15.500" */
export function vttTime(s: number): string {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}.${pad(ms % 1000, 3)}`;
}

/** 75.5 → "1:15", 3725 → "1:02:05" */
export function clock(s: number): string {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** "1:15", "01:02:05" or "75" → seconds; null when it isn't a time. */
export function parseClock(v: string): number | null {
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(s);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** Cues from WebVTT or SubRip text. Styling tags are dropped; empty cues are skipped. */
export function parseCues(text: string): Cue[] {
  const blocks = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const [a, b] = lines[at].split("-->");
    const start = seconds(a);
    const end = seconds(b ?? "");
    if (start === null || end === null) continue;
    const body = lines
      .slice(at + 1)
      .join("\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
      .trim();
    if (body) cues.push({ start, end: Math.max(end, start), text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function toVtt(cues: Cue[]): string {
  return `WEBVTT\n\n${cues.map((c) => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${esc(c.text)}`).join("\n\n")}\n`;
}

/** An uploaded captions file (WebVTT or SubRip) as clean WebVTT; null when it holds no cues. */
export function normalizeCaptions(text: string): string | null {
  const cues = parseCues(text);
  return cues.length ? toVtt(cues) : null;
}

/** The transcript as one block of text: the cues' words, in order. */
export function transcriptText(cues: Cue[]): string {
  return cues.map((c) => c.text.replace(/\s+/g, " ")).join(" ").trim();
}

/** "[1:15] words" per cue, for a model to place chapters. */
export function timedTranscript(cues: Cue[], max = 60_000): string {
  let out = "";
  for (const c of cues) {
    const line = `[${clock(c.start)}] ${c.text.replace(/\s+/g, " ")}\n`;
    if (out.length + line.length > max) break;
    out += line;
  }
  return out;
}

/**
 * Splits text recognised from one piece of audio (start..end seconds) into caption-sized cues,
 * sharing the time out by length: about twelve words a cue, breaking after sentences first.
 */
export function splitIntoCues(text: string, start: number, end: number, maxWords = 12): Cue[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length || end <= start) return [];
  const groups: string[][] = [];
  let cur: string[] = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length >= maxWords || (cur.length >= 4 && /[.!?]["')\]]?$/.test(w))) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);
  const total = words.join(" ").length;
  const out: Cue[] = [];
  let t = start;
  for (const g of groups) {
    const line = g.join(" ");
    const len = ((line.length + 1) / (total + groups.length)) * (end - start);
    out.push({ start: t, end: Math.min(end, t + len), text: line });
    t += len;
  }
  return out;
}

export type Chapter = { t: number; title: string };

/** Chapters as given by a person or a model: sorted, inside the video, titled, no repeats. */
export function cleanChapters(v: unknown, duration: number | null): Chapter[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<number>();
  const out: Chapter[] = [];
  for (const c of v.slice(0, 100)) {
    const t = Number((c as Chapter)?.t);
    const title = String((c as Chapter)?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!Number.isFinite(t) || t < 0 || !title) continue;
    if (duration && t >= duration) continue;
    const at = Math.floor(t);
    if (seen.has(at)) continue;
    seen.add(at);
    out.push({ t: at, title });
  }
  return out.sort((a, b) => a.t - b.t);
}
