// Browser side of slide audio/video: upload to the document's media store and
// read a video's size and first frame for its poster.

const BY_EXT: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", ogv: "video/ogg",
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", oga: "audio/ogg", ogg: "audio/ogg", flac: "audio/flac", wma: "audio/x-ms-wma", wmv: "video/x-ms-wmv", avi: "video/x-msvideo",
};

/** Formats PowerPoint plays that browsers don't (kept, shown as their poster). */
export const NOT_WEB = /^(video\/(x-ms-wmv|x-msvideo|x-ms-asf)|audio\/x-ms-wma)$/;
/** Whether this browser can play a media type. */
export function playableHere(mime: string | undefined, kind: "audio" | "video"): boolean {
  if (!mime) return true;
  if (NOT_WEB.test(mime)) return false;
  if (typeof document === "undefined") return true;
  try {
    return document.createElement(kind).canPlayType(mime) !== "";
  } catch {
    return true;
  }
}

export function mediaMime(type: string, name: string): string {
  const t = (type || "").toLowerCase();
  if (t === "audio/mp3") return "audio/mpeg";
  if (t === "audio/x-m4a") return "audio/mp4";
  if (t && t !== "application/octet-stream") return t;
  return BY_EXT[(name.split(".").pop() || "").toLowerCase()] || "";
}

export function mimeForExt(ext: string): string {
  return BY_EXT[ext.toLowerCase()] || "";
}

/** File extension PowerPoint expects for a MIME type. */
export function extForMime(mime: string): string {
  const m = mime.toLowerCase();
  const hit = Object.entries(BY_EXT).find(([, v]) => v === m);
  if (m === "audio/mpeg") return "mp3";
  if (m === "video/mp4") return "mp4";
  if (m === "audio/mp4") return "m4a";
  return hit?.[0] || m.split("/")[1] || "bin";
}

export async function uploadMedia(docId: string, blob: Blob, name: string, mime: string): Promise<{ url: string; mime: string }> {
  const r = await fetch(`/api/docs/${encodeURIComponent(docId)}/media?name=${encodeURIComponent(name.slice(0, 200))}`, { method: "POST", headers: { "Content-Type": mime }, body: blob });
  if (r.status === 413) throw new Error("the file is larger than 100 MB");
  if (r.status === 415) throw new Error("this audio/video format is not supported (use MP4, WebM, MOV, MP3, M4A, WAV or OGG)");
  if (!r.ok) throw new Error(`upload failed (${r.status})`);
  const j = (await r.json()) as { url: string; mime: string };
  return j;
}

/** A video's natural size and a JPEG of an early frame (null when it cannot be decoded here). */
export function probeVideo(blob: Blob): Promise<{ w: number; h: number; poster?: string } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    let done = false;
    const finish = (r: { w: number; h: number; poster?: string } | null) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      v.removeAttribute("src");
      resolve(r);
    };
    const timer = setTimeout(() => finish(v.videoWidth ? { w: v.videoWidth, h: v.videoHeight } : null), 6000);
    v.onerror = () => { clearTimeout(timer); finish(null); };
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(0.5, (v.duration || 1) / 10);
    };
    v.onseeked = () => {
      clearTimeout(timer);
      try {
        const k = Math.min(1, 640 / (v.videoWidth || 640));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(v.videoWidth * k));
        c.height = Math.max(1, Math.round(v.videoHeight * k));
        c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
        finish({ w: v.videoWidth, h: v.videoHeight, poster: c.toDataURL("image/jpeg", 0.8) });
      } catch {
        finish({ w: v.videoWidth, h: v.videoHeight });
      }
    };
    v.src = url;
  });
}
