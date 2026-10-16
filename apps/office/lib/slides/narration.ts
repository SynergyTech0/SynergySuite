// Narration that PowerPoint plays: recordings are kept as AAC in an MP4
// (.m4a). Browsers whose recorder writes MP4 already give that; otherwise the
// WebM/Opus recording is decoded and re-encoded with WebCodecs' AAC encoder
// and muxed with mp4-muxer. Where the browser has no AAC encoder (Firefox,
// Chromium builds without proprietary codecs) the recording stays WebM/Opus,
// which PowerPoint for the web and recent PowerPoint for Windows play but
// older desktop versions do not.

const AAC = "mp4a.40.2";

/** Can this browser encode AAC (WebCodecs)? */
export async function canEncodeAac(sampleRate = 48000, channels = 1): Promise<boolean> {
  const AE = (globalThis as { AudioEncoder?: typeof AudioEncoder }).AudioEncoder;
  if (!AE) return false;
  return (await AE.isConfigSupported({ codec: AAC, sampleRate, numberOfChannels: channels, bitrate: 96_000 }).catch(() => ({ supported: false }))).supported === true;
}

/** Is this already AAC in MP4 (or another format PowerPoint plays everywhere)? */
export const playsInPowerPoint = (mime: string | undefined) => /^audio\/(mp4|x-m4a|aac|mpeg|wav|x-wav)\b/.test(mime || "");

/**
 * A recording as AAC in MP4 (audio/mp4), or null when it can't be made here.
 * `pcm` is the decoded sound (channels of samples at `rate`).
 */
export async function encodeAacMp4(pcm: Float32Array[], rate: number): Promise<Blob | null> {
  const channels = Math.min(2, pcm.length);
  if (!channels || !(await canEncodeAac(rate, channels))) return null;
  const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, fastStart: "in-memory", audio: { codec: "aac", numberOfChannels: channels, sampleRate: rate } });
  let failed: unknown = null;
  const enc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (failed = e) });
  enc.configure({ codec: AAC, sampleRate: rate, numberOfChannels: channels, bitrate: 96_000 });
  const len = pcm[0].length;
  const N = Math.round(rate / 10);
  for (let i = 0; i < len && !failed; i += N) {
    const n = Math.min(N, len - i);
    const data = new Float32Array(n * channels);
    for (let ch = 0; ch < channels; ch++) data.set(pcm[ch].subarray(i, i + n), ch * n);
    const ad = new AudioData({ format: "f32-planar", sampleRate: rate, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round((i / rate) * 1e6), data });
    enc.encode(ad);
    ad.close();
    if (enc.encodeQueueSize > 16) await new Promise((r) => setTimeout(r, 5));
  }
  await enc.flush().catch((e) => (failed = e));
  enc.close();
  if (failed) return null;
  muxer.finalize();
  return new Blob([target.buffer], { type: "audio/mp4" });
}

/** A narration recording as AAC in MP4 when the browser can make it; else the recording as it is. */
export async function narrationForPowerPoint(blob: Blob): Promise<Blob> {
  if (playsInPowerPoint(blob.type)) return blob;
  const AC = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!AC || !(await canEncodeAac())) return blob;
  try {
    const ctx = new AC();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    void ctx.close();
    const pcm = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, i) => buf.getChannelData(i));
    return (await encodeAacMp4(pcm, buf.sampleRate)) || blob;
  } catch {
    return blob;
  }
}
