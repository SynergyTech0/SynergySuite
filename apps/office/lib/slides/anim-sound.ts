// Sounds on animations. Built-in sounds are made here (short synthesised
// clips, so no recordings are shipped or licensed); other sounds are the
// person's own uploads. PowerPoint plays an animation's sound from an
// embedded WAV file (p:sndTgt), so export turns any sound into 16-bit PCM WAV.
export const BUILTIN_SOUNDS: { id: string; name: string }[] = [
  { id: "chime", name: "Chime" },
  { id: "click", name: "Click" },
  { id: "pop", name: "Pop" },
  { id: "whoosh", name: "Whoosh" },
  { id: "drumroll", name: "Drum roll" },
];
export const BUILTIN_PREFIX = "builtin:";
const RATE = 22050;

/** 16-bit PCM WAV bytes of mono or interleaved samples (-1..1). */
export function wavBytes(channels: Float32Array[], rate: number): Uint8Array {
  const nc = Math.max(1, channels.length), n = channels[0]?.length || 0;
  const out = new Uint8Array(44 + n * nc * 2);
  const v = new DataView(out.buffer);
  const tag = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  tag(0, "RIFF");
  v.setUint32(4, 36 + n * nc * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nc, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * nc * 2, true);
  v.setUint16(32, nc * 2, true);
  v.setUint16(34, 16, true);
  tag(36, "data");
  v.setUint32(40, n * nc * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < nc; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i] || 0));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  return out;
}

/** A small deterministic noise source (the same clip every time). */
function noise(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) / 0xffffffff) * 2 - 1;
  };
}

/** The samples of a built-in sound, or null for an unknown id. */
export function builtinSamples(id: string): Float32Array | null {
  const len = (s: number) => new Float32Array(Math.round(RATE * s));
  const t = (i: number) => i / RATE;
  if (id === "chime") {
    const a = len(1.2);
    for (let i = 0; i < a.length; i++) {
      const x = t(i);
      a[i] = 0.35 * Math.exp(-3 * x) * (Math.sin(2 * Math.PI * 880 * x) + 0.5 * Math.sin(2 * Math.PI * 1320 * x) + 0.25 * Math.sin(2 * Math.PI * 1760 * x));
    }
    return a;
  }
  if (id === "click") {
    const a = len(0.05), r = noise(7);
    for (let i = 0; i < a.length; i++) a[i] = 0.8 * Math.exp(-t(i) * 180) * r();
    return a;
  }
  if (id === "pop") {
    const a = len(0.15);
    let ph = 0;
    for (let i = 0; i < a.length; i++) {
      const x = t(i);
      ph += (2 * Math.PI * (900 - 4000 * x)) / RATE;
      a[i] = 0.7 * Math.exp(-x * 35) * Math.sin(ph);
    }
    return a;
  }
  if (id === "whoosh") {
    const a = len(0.7), r = noise(11);
    let lp = 0;
    for (let i = 0; i < a.length; i++) {
      const x = t(i) / 0.7;
      const k = 0.02 + 0.25 * Math.sin(Math.PI * x); // the filter opens and closes
      lp += k * (r() - lp);
      a[i] = 1.6 * Math.sin(Math.PI * x) * lp;
    }
    return a;
  }
  if (id === "drumroll") {
    const a = len(1.5), r = noise(23);
    for (let i = 0; i < a.length; i++) {
      const x = t(i), hit = (x * 22) % 1;
      a[i] = 0.5 * (0.4 + 0.6 * (x / 1.5)) * Math.exp(-hit * 6) * r();
    }
    return a;
  }
  return null;
}

/** The WAV bytes of a built-in sound ("builtin:<id>" or the bare id). */
export function builtinWav(src: string): Uint8Array | null {
  const s = builtinSamples(src.startsWith(BUILTIN_PREFIX) ? src.slice(BUILTIN_PREFIX.length) : src);
  return s ? wavBytes([s], RATE) : null;
}

/** True for RIFF/WAVE bytes. */
export const isWav = (b: Uint8Array) => b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WAVE";

const urls = new Map<string, string>();
/** A URL the browser can play for an animation sound. */
export function soundUrl(src: string): string {
  if (!src.startsWith(BUILTIN_PREFIX)) return src;
  let u = urls.get(src);
  if (!u) {
    const b = builtinWav(src);
    u = b ? URL.createObjectURL(new Blob([b as BlobPart], { type: "audio/wav" })) : "";
    urls.set(src, u);
  }
  return u;
}

/**
 * The sound as WAV for PowerPoint: built-ins are made, WAV files pass
 * through, other formats are decoded by the browser and written as PCM.
 * Null when it can't be read or decoded here.
 */
export async function soundAsWav(src: string): Promise<Uint8Array | null> {
  if (src.startsWith(BUILTIN_PREFIX)) return builtinWav(src);
  try {
    const r = await fetch(src, { credentials: "same-origin" });
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (isWav(bytes)) return bytes;
    const AC = (globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
    if (!AC) return null;
    const ctx = new AC(1, 1, 44100);
    const buf = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const chans = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, c) => buf.getChannelData(c));
    return wavBytes(chans, buf.sampleRate);
  } catch {
    return null;
  }
}
