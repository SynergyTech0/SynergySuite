import { spawn } from "node:child_process";

/** Plain 16-bit PCM audio, mono. Voicemail, greetings and tones are all kept this way. */
export type Pcm = { rate: number; samples: Int16Array };

export function encodeWav({ rate, samples }: Pcm): Buffer {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Reads a 16-bit PCM WAV (any channel count; channels are mixed down). Null for anything else. */
export function decodeWav(buf: Buffer): Pcm | null {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null;
  let at = 12;
  let rate = 0;
  let channels = 0;
  let bits = 0;
  let format = 0;
  while (at + 8 <= buf.length) {
    const id = buf.toString("ascii", at, at + 4);
    let size = buf.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt ") {
      format = buf.readUInt16LE(body);
      channels = buf.readUInt16LE(body + 2);
      rate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      if (format !== 1 || bits !== 16 || !channels || !rate) return null;
      // Streams written to a pipe (espeak --stdout) give 0 or 0xffffffff as the size.
      if (!size || size === 0xffffffff || body + size > buf.length) size = buf.length - body;
      const frames = Math.floor(size / (2 * channels));
      const out = new Int16Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let ch = 0; ch < channels; ch++) sum += buf.readInt16LE(body + (i * channels + ch) * 2);
        out[i] = Math.round(sum / channels);
      }
      return { rate, samples: out };
    }
    at = body + size + (size % 2);
  }
  return null;
}

/** Linear-interpolation resampling: plenty for speech on a phone line. */
export function resample(p: Pcm, rate: number): Pcm {
  if (p.rate === rate || !p.samples.length) return { rate, samples: p.samples };
  const n = Math.max(1, Math.round((p.samples.length * rate) / p.rate));
  const out = new Int16Array(n);
  const step = p.rate / rate;
  for (let i = 0; i < n; i++) {
    const x = i * step;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, p.samples.length - 1);
    const f = x - i0;
    out[i] = Math.round(p.samples[Math.min(i0, p.samples.length - 1)] * (1 - f) + p.samples[i1] * f);
  }
  return { rate, samples: out };
}

/** A sum of sine tones, `ms` long, with short fades so it doesn't click. */
export function tone(freqs: number[], ms: number, rate: number, level = 0.25): Int16Array {
  const n = Math.round((rate * ms) / 1000);
  const out = new Int16Array(n);
  const fade = Math.min(Math.round(rate * 0.01), Math.floor(n / 2));
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (const f of freqs) v += Math.sin((2 * Math.PI * f * i) / rate);
    const env = Math.min(1, i / fade, (n - 1 - i) / fade);
    out[i] = Math.round((v / freqs.length) * level * env * 32767);
  }
  return out;
}

export const silence = (ms: number, rate: number) => new Int16Array(Math.round((rate * ms) / 1000));

/** The tone a caller hears before leaving a message. */
export const beep = (rate: number) => tone([1000], 450, rate, 0.3);

/** One cycle of ringback as callers in North America hear it: 2 s of 440 + 480 Hz, 4 s quiet. */
export const ringbackCycle = (rate: number) => concat([tone([440, 480], 2000, rate, 0.2), silence(4000, rate)]);

export function concat(parts: Int16Array[]): Int16Array {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function durationMs(p: Pcm): number {
  return Math.round((p.samples.length / p.rate) * 1000);
}

/** Loudness of a stretch of audio, 0 to 1 (RMS). */
export function level(samples: Int16Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length) / 32768;
}

/**
 * Speaks `text` with eSpeak NG (GPL-3.0, installed in the Phone image as a separate program),
 * for the default voicemail greeting. Null when it isn't installed or fails; voicemail then
 * plays only the tone.
 */
export async function speak(text: string, opts: { voice?: string; bin?: string; timeoutMs?: number } = {}): Promise<Pcm | null> {
  const bin = opts.bin ?? process.env.PHONE_TTS_BIN ?? "espeak-ng";
  const voice = opts.voice ?? process.env.PHONE_TTS_VOICE ?? "en-us";
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: Pcm | null) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    let child;
    try {
      child = spawn(bin, ["--stdout", "-v", voice, "-s", "160", text.slice(0, 600)], { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return finish(null);
    }
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, opts.timeoutMs ?? 10_000);
    child.stdout.on("data", (b: Buffer) => chunks.push(b));
    child.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code === 0 ? decodeWav(Buffer.concat(chunks)) : null);
    });
  });
}
