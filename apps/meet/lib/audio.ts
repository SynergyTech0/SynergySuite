/** 16-bit mono PCM helpers for the transcriber (same shapes as Phone's lib/audio.ts). */
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

export function concat(parts: Int16Array[]): Int16Array {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Loudness of a stretch of audio, 0 to 1 (RMS). */
export function level(samples: Int16Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length) / 32768;
}

export type Utterance = { samples: Int16Array; startMs: number };

/**
 * Cuts one speaker's audio into utterances: speech starts when a 20 ms frame is louder than
 * `threshold`, and ends after `pauseMs` of quiet or at `maxMs`. Stretches with less than `minSpeechMs`
 * of speech are dropped (a cough, a door). `startMs` counts from the first sample pushed.
 */
export class Segmenter {
  private frame: number;
  private pending = new Int16Array(0);
  private parts: Int16Array[] = [];
  private pre: Int16Array[] = [];
  private inSpeech = false;
  private voiced = 0;
  private quiet = 0;
  private length = 0;
  private start = 0;
  private pos = 0;

  constructor(
    private rate = 16_000,
    private opts = { threshold: 0.012, pauseMs: 900, maxMs: 30_000, minSpeechMs: 400, prerollMs: 200 },
  ) {
    this.frame = Math.round(rate / 50);
  }

  private ms(samples: number) {
    return (samples / this.rate) * 1000;
  }

  push(samples: Int16Array): Utterance[] {
    const out: Utterance[] = [];
    const all = this.pending.length ? concat([this.pending, samples]) : samples;
    let at = 0;
    for (; at + this.frame <= all.length; at += this.frame) {
      const f = all.slice(at, at + this.frame);
      const loud = level(f) >= this.opts.threshold;
      if (!this.inSpeech) {
        this.pre.push(f);
        while (this.pre.length * this.frame > (this.opts.prerollMs / 1000) * this.rate) this.pre.shift();
        if (loud) {
          this.inSpeech = true;
          this.parts = [...this.pre];
          this.length = this.pre.length * this.frame;
          this.start = this.pos - (this.pre.length - 1) * this.frame;
          this.pre = [];
          this.voiced = this.frame;
          this.quiet = 0;
        }
      } else {
        this.parts.push(f);
        this.length += this.frame;
        if (loud) {
          this.voiced += this.frame;
          this.quiet = 0;
        } else this.quiet += this.frame;
        if (this.ms(this.quiet) >= this.opts.pauseMs || this.ms(this.length) >= this.opts.maxMs) {
          const u = this.finish();
          if (u) out.push(u);
        }
      }
      this.pos += this.frame;
    }
    this.pending = all.slice(at);
    return out;
  }

  /** The utterance in progress, if any (the speaker left or the meeting ended). */
  flush(): Utterance | null {
    return this.inSpeech ? this.finish() : null;
  }

  private finish(): Utterance | null {
    const enough = this.ms(this.voiced) >= this.opts.minSpeechMs;
    const u = { samples: concat(this.parts), startMs: Math.max(0, this.ms(this.start)) };
    this.inSpeech = false;
    this.parts = [];
    this.voiced = this.quiet = this.length = 0;
    return enough ? u : null;
  }
}
