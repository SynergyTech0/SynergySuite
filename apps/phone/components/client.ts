"use client";
// Browser-side helpers shared by the Phone screens.

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

/** "3:07" or "1:02:45". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "2:14 PM", "Yesterday", "Mon" or "Oct 3". */
export function when(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "#";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Same rule as the server: something with a plus or enough digits to be a phone number. */
export function looksLikeNumber(s: string): boolean {
  return !/[a-z@]/i.test(s) && s.replace(/\D/g, "").length >= 3;
}

/**
 * Ringtones made in the browser with Web Audio, so nothing has to be downloaded and they start
 * at once. ring(): the incoming-call tone. ringback(): what a caller hears while it rings.
 */
export class Tones {
  private ctx: AudioContext | null = null;
  private stopFn: (() => void) | null = null;

  private context(): AudioContext {
    this.ctx ??= new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private loop(freqs: number[], onMs: number, offMs: number, gain: number, double = false): void {
    this.stop();
    const ctx = this.context();
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(ctx.destination);
    const oscs = freqs.map((f) => {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(out);
      o.start();
      return o;
    });
    const period = (onMs + offMs) / 1000;
    let t = ctx.currentTime + 0.05;
    let stopped = false;
    const schedule = () => {
      if (stopped) return;
      while (t < ctx.currentTime + 4) {
        const bursts = double ? [[0, 0.4], [0.6, 1.0]] : [[0, onMs / 1000]];
        for (const [a, b] of bursts) {
          out.gain.setValueAtTime(0, t + a);
          out.gain.linearRampToValueAtTime(gain, t + a + 0.02);
          out.gain.setValueAtTime(gain, t + b - 0.02);
          out.gain.linearRampToValueAtTime(0, t + b);
        }
        t += period;
      }
    };
    schedule();
    const timer = setInterval(schedule, 1000);
    this.stopFn = () => {
      stopped = true;
      clearInterval(timer);
      out.gain.cancelScheduledValues(0);
      out.gain.value = 0;
      oscs.forEach((o) => o.stop());
      out.disconnect();
    };
  }

  ring(): void {
    this.loop([440, 480], 1000, 2000, 0.12, true);
  }

  ringback(): void {
    this.loop([440, 480], 2000, 4000, 0.06);
  }

  /** A single short beep (a DTMF key press, a call ending). */
  blip(freqs = [941, 1336], ms = 120): void {
    const ctx = this.context();
    const g = ctx.createGain();
    g.gain.value = 0.08;
    g.connect(ctx.destination);
    for (const f of freqs) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(g);
      o.start();
      o.stop(ctx.currentTime + ms / 1000);
    }
    setTimeout(() => g.disconnect(), ms + 50);
  }

  stop(): void {
    this.stopFn?.();
    this.stopFn = null;
  }
}

/** DTMF frequencies for the keypad's own sound. */
export const DTMF: Record<string, [number, number]> = {
  "1": [697, 1209], "2": [697, 1336], "3": [697, 1477], "4": [770, 1209], "5": [770, 1336], "6": [770, 1477],
  "7": [852, 1209], "8": [852, 1336], "9": [852, 1477], "*": [941, 1209], "0": [941, 1336], "#": [941, 1477],
};

/** Records a greeting with the microphone and hands it back as 16 kHz mono 16-bit WAV. */
export async function blobToWav(blob: Blob, rate = 16_000): Promise<Blob> {
  const buf = await blob.arrayBuffer();
  const decoded = await new AudioContext().decodeAudioData(buf);
  const frames = Math.ceil(decoded.duration * rate);
  const off = new OfflineAudioContext(1, frames, rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  const data = rendered.getChannelData(0);
  const pcm = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(data[i] * 32767)));
  const header = new DataView(new ArrayBuffer(44));
  const w = (o: number, s: string) => [...s].forEach((c, i) => header.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  header.setUint32(4, 36 + pcm.byteLength, true);
  w(8, "WAVE");
  w(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, rate, true);
  header.setUint32(28, rate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  w(36, "data");
  header.setUint32(40, pcm.byteLength, true);
  return new Blob([header.buffer, pcm.buffer], { type: "audio/wav" });
}
