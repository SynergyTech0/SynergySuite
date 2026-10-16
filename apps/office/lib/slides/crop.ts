// A cropped copy of a picture, for formats whose readers don't apply a crop
// (LibreOffice ignores fo:clip on pictures in presentations). SVG pictures are
// cropped by their viewBox, so they stay vector; bitmaps are redrawn on a
// canvas at their own resolution. Null where that can't be done (no canvas,
// unreadable picture), and the caller keeps the whole picture.
import type { Crop } from "./model";

async function bytesOf(src: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const r = await fetch(src, { credentials: "same-origin" });
    if (!r.ok) return null;
    const mime = (r.headers.get("content-type") || "").split(";")[0] || (/^data:([^;,]+)/.exec(src)?.[1] ?? "");
    return { bytes: new Uint8Array(await r.arrayBuffer()), mime };
  } catch {
    return null;
  }
}

const num = (v: string | undefined) => (v ? parseFloat(v) : NaN);

/** An SVG document cropped to the part `crop` leaves (fractions cut from each edge). */
export function cropSvg(svg: string, crop: Crop): string | null {
  const m = /<svg\b[^>]*>/i.exec(svg);
  if (!m) return null;
  const tag = m[0];
  const at = (k: string) => new RegExp(`\\s${k}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];
  const vb = (at("viewBox") || "").split(/[\s,]+/).map(Number);
  const w = num(at("width")), h = num(at("height"));
  const [x, y, vw, vh] = vb.length === 4 && vb.every(Number.isFinite) ? vb : [0, 0, w, h];
  if (!(vw > 0 && vh > 0)) return null;
  const nx = x + crop.l * vw, ny = y + crop.t * vh, nw = vw * (1 - crop.l - crop.r), nh = vh * (1 - crop.t - crop.b);
  if (!(nw > 0 && nh > 0)) return null;
  const ow = Number.isFinite(w) && w > 0 ? w : vw, oh = Number.isFinite(h) && h > 0 ? h : vh;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const next = tag
    .replace(/\s(viewBox|width|height|preserveAspectRatio)\s*=\s*["'][^"']*["']/gi, "")
    .replace(/^<svg\b/i, `<svg viewBox="${r(nx)} ${r(ny)} ${r(nw)} ${r(nh)}" width="${r(ow * (1 - crop.l - crop.r))}" height="${r(oh * (1 - crop.t - crop.b))}" preserveAspectRatio="none"`);
  return svg.slice(0, m.index) + next + svg.slice(m.index + tag.length);
}

const toDataUrl = (bytes: Uint8Array, mime: string) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
};

/** The picture at `src` with `crop` applied, as a data URL. */
export async function croppedPicture(src: string, crop: Crop): Promise<string | null> {
  const got = await bytesOf(src);
  if (!got) return null;
  const { bytes, mime } = got;
  if (mime === "image/svg+xml" || /^\s*(<\?xml[^>]*>\s*)?<svg\b/i.test(new TextDecoder().decode(bytes.subarray(0, 200)))) {
    const out = cropSvg(new TextDecoder().decode(bytes), crop);
    return out ? toDataUrl(new TextEncoder().encode(out), "image/svg+xml") : null;
  }
  const g = globalThis as unknown as { createImageBitmap?: typeof createImageBitmap; OffscreenCanvas?: typeof OffscreenCanvas; document?: Document };
  if (!g.createImageBitmap || (!g.OffscreenCanvas && !g.document)) return null;
  try {
    const bmp = await g.createImageBitmap(new Blob([bytes as BlobPart], { type: mime || "image/png" }));
    const sx = Math.round(crop.l * bmp.width), sy = Math.round(crop.t * bmp.height);
    const sw = Math.max(1, Math.round(bmp.width * (1 - crop.l - crop.r))), sh = Math.max(1, Math.round(bmp.height * (1 - crop.t - crop.b)));
    const type = mime === "image/jpeg" ? "image/jpeg" : "image/png";
    let blob: Blob;
    if (g.OffscreenCanvas) {
      const cv = new g.OffscreenCanvas(sw, sh);
      cv.getContext("2d")!.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
      blob = await cv.convertToBlob({ type, quality: 0.92 });
    } else {
      const cv = g.document!.createElement("canvas");
      cv.width = sw;
      cv.height = sh;
      cv.getContext("2d")!.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
      blob = await new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("canvas"))), type, 0.92));
    }
    bmp.close?.();
    return toDataUrl(new Uint8Array(await blob.arrayBuffer()), type);
  } catch {
    return null;
  }
}
