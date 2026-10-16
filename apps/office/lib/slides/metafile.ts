// Windows metafiles (EMF and WMF), the vector pictures older decks and pasted
// charts carry, drawn as SVG so a browser can show them: lines, polygons,
// Béziers, rectangles, ellipses, paths, text and embedded bitmaps, with pens,
// brushes, fonts and the window/viewport mapping. Clipping, raster operations
// and EMF+ records are left out (EMF+ files keep GDI records for readers like
// this one). Bitmaps are embedded as BMP data URLs, so nothing here needs a
// canvas.

type Pen = { color: string; width: number; none: boolean };
type Brush = { color: string; none: boolean };
type Font = { height: number; weight: number; italic: boolean; underline: boolean; face: string; escapement: number };
type Obj = { pen?: Pen; brush?: Brush; font?: Font } | null;
type Xform = [number, number, number, number, number, number];
type State = {
  pen: Pen;
  brush: Brush;
  font: Font;
  textColor: string;
  textAlign: number;
  fillRule: "evenodd" | "nonzero";
  mapMode: number;
  winOrg: [number, number];
  winExt: [number, number];
  vpOrg: [number, number];
  vpExt: [number, number];
  world: Xform;
  cur: [number, number];
};

const MAX_SHAPES = 40000;
const hex2 = (n: number) => n.toString(16).padStart(2, "0");
/** COLORREF (0x00bbggrr) as #rrggbb. */
const colorRef = (v: number) => `#${hex2(v & 255)}${hex2((v >> 8) & 255)}${hex2((v >> 16) & 255)}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const r2 = (n: number) => Math.round(n * 100) / 100;

function b64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** A device-independent bitmap (header, colour table, bits) as a BMP data URL. */
function dibToBmp(dib: Uint8Array, bits?: Uint8Array): string | null {
  if (dib.length < 12) return null;
  const dv = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
  const hsize = dv.getUint32(0, true);
  if (hsize !== 12 && hsize < 40) return null;
  let full = bits ? concat(dib, bits) : dib;
  // 32-bit pixels with an alpha channel: a header whose masks say so, or browsers draw them opaque
  const comp = hsize === 40 ? dv.getUint32(16, true) : -1;
  if (hsize === 40 && dv.getUint16(14, true) === 32 && (comp === 0 || comp === 3)) {
    const fd = new DataView(full.buffer, full.byteOffset, full.byteLength);
    const masks = comp === 3 && full.length >= 52 ? [fd.getUint32(40, true), fd.getUint32(44, true), fd.getUint32(48, true)] : [0x00ff0000, 0x0000ff00, 0x000000ff];
    const px = full.subarray(comp === 3 ? 52 : 40);
    let alpha = false;
    for (let k = 3; k < px.length; k += 4) if (px[k]) { alpha = true; break; }
    if (alpha) {
      const v4 = new Uint8Array(108 + px.length);
      v4.set(full.subarray(0, 40), 0);
      const h = new DataView(v4.buffer);
      h.setUint32(0, 108, true);
      h.setUint32(16, 3, true); // BI_BITFIELDS
      h.setUint32(40, masks[0], true);
      h.setUint32(44, masks[1], true);
      h.setUint32(48, masks[2], true);
      h.setUint32(52, 0xff000000, true);
      h.setUint32(56, 0x73524742, true); // sRGB
      v4.set(px, 108);
      full = v4;
      return bmp(full, 108);
    }
  }
  let paletteBytes: number;
  if (hsize === 12) {
    const bpp = dv.getUint16(10, true);
    paletteBytes = bpp <= 8 ? (1 << bpp) * 3 : 0;
  } else {
    const bpp = dv.getUint16(14, true);
    const compression = dv.getUint32(16, true);
    const used = dv.getUint32(32, true);
    paletteBytes = (bpp <= 8 ? used || 1 << bpp : used) * 4 + (compression === 3 && hsize === 40 ? 12 : 0);
  }
  return bmp(full, hsize + paletteBytes);
}

/** A BMP file around a DIB whose pixels start `pixAt` bytes in. */
function bmp(dib: Uint8Array, pixAt: number): string {
  const out = new Uint8Array(14 + dib.length);
  const o = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  o.setUint32(2, out.length, true);
  o.setUint32(10, 14 + pixAt, true);
  out.set(dib, 14);
  return `data:image/bmp;base64,${b64(out)}`;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

class Painter {
  st: State;
  saved: State[] = [];
  out: string[] = [];
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;
  path: string[] | null = null;
  constructor() {
    this.st = {
      pen: { color: "#000000", width: 1, none: false },
      brush: { color: "#ffffff", none: false },
      font: { height: 12, weight: 400, italic: false, underline: false, face: "Arial", escapement: 0 },
      textColor: "#000000",
      textAlign: 0,
      fillRule: "evenodd",
      mapMode: 1,
      winOrg: [0, 0],
      winExt: [1, 1],
      vpOrg: [0, 0],
      vpExt: [1, 1],
      world: [1, 0, 0, 1, 0, 0],
      cur: [0, 0],
    };
  }
  save() {
    this.saved.push(structuredClone(this.st));
  }
  restore(n: number) {
    // n < 0: that many back; else the n-th saved state
    const k = n < 0 ? this.saved.length + n : n - 1;
    if (k < 0 || k >= this.saved.length) return;
    this.st = this.saved[k];
    this.saved.length = k;
  }
  scale(): [number, number] {
    const { mapMode, winExt, vpExt, world } = this.st;
    const sx = (mapMode === 7 || mapMode === 8) && winExt[0] ? vpExt[0] / winExt[0] : 1;
    const sy = (mapMode === 7 || mapMode === 8) && winExt[1] ? vpExt[1] / winExt[1] : 1;
    return [Math.hypot(world[0], world[1]) * sx, Math.hypot(world[2], world[3]) * sy];
  }
  /** Logical point -> device point. */
  pt(x: number, y: number): [number, number] {
    const [a, b, c, d, e, f] = this.st.world;
    const wx = a * x + c * y + e, wy = b * x + d * y + f;
    const { mapMode, winOrg, winExt, vpOrg, vpExt } = this.st;
    let px: number, py: number;
    if (mapMode === 0) {
      // WMF: drawn in logical units, the window is the picture's frame
      px = wx;
      py = wy;
    } else if ((mapMode === 7 || mapMode === 8) && winExt[0] && winExt[1]) {
      px = ((wx - winOrg[0]) * vpExt[0]) / winExt[0] + vpOrg[0];
      py = ((wy - winOrg[1]) * vpExt[1]) / winExt[1] + vpOrg[1];
    } else {
      px = wx - winOrg[0] + vpOrg[0];
      py = wy - winOrg[1] + vpOrg[1];
    }
    if (px < this.minX) this.minX = px;
    if (px > this.maxX) this.maxX = px;
    if (py < this.minY) this.minY = py;
    if (py > this.maxY) this.maxY = py;
    return [r2(px), r2(py)];
  }
  penAttrs(): string {
    const p = this.st.pen;
    if (p.none) return ' stroke="none"';
    const w = Math.max(p.width * Math.abs(this.scale()[0]), 0) || 1;
    return ` stroke="${p.color}" stroke-width="${r2(w)}" stroke-linejoin="round" stroke-linecap="round"`;
  }
  fillAttrs(): string {
    const b = this.st.brush;
    return b.none ? ' fill="none"' : ` fill="${b.color}" fill-rule="${this.st.fillRule}"`;
  }
  emit(s: string) {
    if (this.out.length < MAX_SHAPES) this.out.push(s);
  }
  poly(pts: [number, number][], closed: boolean, fill: boolean) {
    if (pts.length < 2) return;
    const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${this.pt(x, y).join(" ")}`).join("") + (closed ? "Z" : "");
    if (this.path) return void this.path.push(d);
    this.emit(`<path d="${d}"${fill ? this.fillAttrs() : ' fill="none"'}${this.penAttrs()}/>`);
  }
  polys(list: [number, number][][], closed: boolean) {
    const d = list
      .filter((p) => p.length > 1)
      .map((pts) => pts.map(([x, y], i) => `${i ? "L" : "M"}${this.pt(x, y).join(" ")}`).join("") + (closed ? "Z" : ""))
      .join("");
    if (!d) return;
    if (this.path) return void this.path.push(d);
    this.emit(`<path d="${d}"${closed ? this.fillAttrs() : ' fill="none"'}${this.penAttrs()}/>`);
  }
  bezier(pts: [number, number][], from?: [number, number]) {
    const all = from ? [from, ...pts] : pts;
    if (all.length < 4) return;
    let d = `M${this.pt(...all[0]).join(" ")}`;
    for (let i = 1; i + 2 < all.length; i += 3) d += `C${this.pt(...all[i]).join(" ")} ${this.pt(...all[i + 1]).join(" ")} ${this.pt(...all[i + 2]).join(" ")}`;
    if (this.path) return void this.path.push(from ? d.replace(/^M[^C]*/, "") : d);
    this.emit(`<path d="${d}" fill="none"${this.penAttrs()}/>`);
  }
  rect(l: number, t: number, r: number, b: number, rx = 0, ry = 0) {
    const [x0, y0] = this.pt(l, t), [x1, y1] = this.pt(r, b);
    const [sx, sy] = this.scale();
    if (this.path) return void this.path.push(`M${x0} ${y0}H${x1}V${y1}H${x0}Z`);
    this.emit(`<rect x="${Math.min(x0, x1)}" y="${Math.min(y0, y1)}" width="${r2(Math.abs(x1 - x0))}" height="${r2(Math.abs(y1 - y0))}"${rx ? ` rx="${r2(Math.abs((rx * sx) / 2))}" ry="${r2(Math.abs((ry * sy) / 2))}"` : ""}${this.fillAttrs()}${this.penAttrs()}/>`);
  }
  ellipse(l: number, t: number, r: number, b: number) {
    const [x0, y0] = this.pt(l, t), [x1, y1] = this.pt(r, b);
    this.emit(`<ellipse cx="${r2((x0 + x1) / 2)}" cy="${r2((y0 + y1) / 2)}" rx="${r2(Math.abs(x1 - x0) / 2)}" ry="${r2(Math.abs(y1 - y0) / 2)}"${this.fillAttrs()}${this.penAttrs()}/>`);
  }
  line(x: number, y: number) {
    const [x0, y0] = this.pt(...this.st.cur), [x1, y1] = this.pt(x, y);
    if (this.path) this.path.push(`L${x1} ${y1}`);
    else this.emit(`<path d="M${x0} ${y0}L${x1} ${y1}" fill="none"${this.penAttrs()}/>`);
    this.st.cur = [x, y];
  }
  moveTo(x: number, y: number) {
    this.st.cur = [x, y];
    if (this.path) this.path.push(`M${this.pt(x, y).join(" ")}`);
  }
  endPath(fill: boolean, stroke: boolean) {
    const d = (this.path || []).join("");
    this.path = null;
    if (!d) return;
    this.emit(`<path d="${d}"${fill ? this.fillAttrs() : ' fill="none"'}${stroke ? this.penAttrs() : ' stroke="none"'}/>`);
  }
  text(x: number, y: number, s: string) {
    if (!s.trim()) return;
    const f = this.st.font;
    const [px, py] = this.pt(x, y);
    const size = Math.abs(f.height * this.scale()[1]) || 12;
    const a = this.st.textAlign;
    const anchor = (a & 6) === 6 ? "middle" : a & 2 ? "end" : "start";
    const base = a & 24 ? (a & 24) === 24 ? "alphabetic" : "text-after-edge" : "text-before-edge";
    const rot = f.escapement ? ` transform="rotate(${r2(-f.escapement / 10)} ${px} ${py})"` : "";
    this.emit(
      `<text x="${px}" y="${py}" font-family="${esc(`'${f.face.replace(/'/g, "")}', Arial, sans-serif`)}" font-size="${r2(size)}"${f.weight >= 600 ? ' font-weight="bold"' : ""}${f.italic ? ' font-style="italic"' : ""}${f.underline ? ' text-decoration="underline"' : ""} fill="${this.st.textColor}" text-anchor="${anchor}" dominant-baseline="${base}"${rot} xml:space="preserve">${esc(s)}</text>`,
    );
  }
  image(l: number, t: number, w: number, h: number, href: string | null) {
    if (!href) return;
    const [x0, y0] = this.pt(l, t), [x1, y1] = this.pt(l + w, t + h);
    const fx = x1 < x0, fy = y1 < y0;
    const x = Math.min(x0, x1), y = Math.min(y0, y1), W = Math.abs(x1 - x0), H = Math.abs(y1 - y0);
    const flip = fx || fy ? ` transform="translate(${fx ? r2(2 * x + W) : 0} ${fy ? r2(2 * y + H) : 0}) scale(${fx ? -1 : 1} ${fy ? -1 : 1})"` : "";
    this.emit(`<image x="${r2(x)}" y="${r2(y)}" width="${r2(W)}" height="${r2(H)}" preserveAspectRatio="none" href="${href}"${flip}/>`);
  }
  svg(view: [number, number, number, number] | null): string | null {
    if (!this.out.length) return null;
    const v = view && view[2] > 0 && view[3] > 0 ? view : this.maxX > this.minX && this.maxY > this.minY ? [this.minX, this.minY, this.maxX - this.minX, this.maxY - this.minY] : null;
    if (!v) return null;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${v.map(r2).join(" ")}" width="${r2(v[2])}" height="${r2(v[3])}" preserveAspectRatio="none" overflow="hidden">${this.out.join("")}</svg>`;
  }
}

// ------------------------------------------------------------------ EMF

const STOCK: Record<number, Obj> = {
  0: { brush: { color: "#ffffff", none: false } },
  1: { brush: { color: "#c0c0c0", none: false } },
  2: { brush: { color: "#808080", none: false } },
  3: { brush: { color: "#404040", none: false } },
  4: { brush: { color: "#000000", none: false } },
  5: { brush: { color: "#000000", none: true } },
  6: { pen: { color: "#ffffff", width: 1, none: false } },
  7: { pen: { color: "#000000", width: 1, none: false } },
  8: { pen: { color: "#000000", width: 1, none: true } },
};

function emfToSvg(buf: Uint8Array): string | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 88 || dv.getUint32(0, true) !== 1 || dv.getUint32(40, true) !== 0x464d4520) return null;
  const P = new Painter();
  const objs: Obj[] = [];
  const bl = dv.getInt32(8, true), bt = dv.getInt32(12, true), br = dv.getInt32(16, true), bb = dv.getInt32(20, true);
  const i32 = (o: number) => dv.getInt32(o, true);
  const u32 = (o: number) => dv.getUint32(o, true);
  const i16 = (o: number) => dv.getInt16(o, true);
  const pts16 = (o: number, n: number) => Array.from({ length: n }, (_, k) => [i16(o + k * 4), i16(o + k * 4 + 2)] as [number, number]);
  const pts32 = (o: number, n: number) => Array.from({ length: n }, (_, k) => [i32(o + k * 8), i32(o + k * 8 + 4)] as [number, number]);
  const utf16 = (o: number, n: number) => {
    let s = "";
    for (let k = 0; k < n && o + k * 2 + 1 < buf.length; k++) s += String.fromCharCode(dv.getUint16(o + k * 2, true));
    return s;
  };
  let off = 0;
  for (let guard = 0; off + 8 <= buf.length && guard < 2_000_000; guard++) {
    const type = u32(off), size = u32(off + 4);
    if (size < 8 || off + size > buf.length) break;
    const o = off;
    const polyN = (wide: boolean, f: (pts: [number, number][]) => void) => {
      const n = u32(o + 24);
      if (28 + n * (wide ? 8 : 4) <= size) f(wide ? pts32(o + 28, n) : pts16(o + 28, n));
    };
    const polyPoly = (wide: boolean, closed: boolean) => {
      const np = u32(o + 24), total = u32(o + 28);
      if (32 + np * 4 + total * (wide ? 8 : 4) > size) return;
      const counts = Array.from({ length: np }, (_, k) => u32(o + 32 + k * 4));
      let p = o + 32 + np * 4;
      const list: [number, number][][] = [];
      for (const c of counts) {
        list.push(wide ? pts32(p, c) : pts16(p, c));
        p += c * (wide ? 8 : 4);
      }
      P.polys(list, closed);
    };
    switch (type) {
      case 14: // EOF
        off = buf.length;
        continue;
      case 2: case 86: polyN(type === 2, (p) => P.bezier(p)); break; // POLYBEZIER
      case 3: case 87: polyN(type === 3, (p) => P.poly(p, true, true)); break; // POLYGON
      case 4: case 88: polyN(type === 4, (p) => P.poly(p, false, false)); break; // POLYLINE
      case 5: case 89: polyN(type === 5, (p) => { P.bezier(p, P.st.cur); if (p.length) P.st.cur = p[p.length - 1]; }); break; // POLYBEZIERTO
      case 6: case 90: polyN(type === 6, (p) => { for (const q of p) P.line(q[0], q[1]); }); break; // POLYLINETO
      case 7: case 91: polyPoly(type === 7, false); break;
      case 8: case 92: polyPoly(type === 8, true); break;
      case 9: P.st.winExt = [i32(o + 8), i32(o + 12)]; break;
      case 10: P.st.winOrg = [i32(o + 8), i32(o + 12)]; break;
      case 11: P.st.vpExt = [i32(o + 8), i32(o + 12)]; break;
      case 12: P.st.vpOrg = [i32(o + 8), i32(o + 12)]; break;
      case 17: P.st.mapMode = u32(o + 8); break;
      case 19: P.st.fillRule = u32(o + 8) === 2 ? "nonzero" : "evenodd"; break;
      case 22: P.st.textAlign = u32(o + 8); break;
      case 24: P.st.textColor = colorRef(u32(o + 8)); break;
      case 27: P.moveTo(i32(o + 8), i32(o + 12)); break;
      case 54: P.line(i32(o + 8), i32(o + 12)); break;
      case 33: P.save(); break;
      case 34: P.restore(i32(o + 8)); break;
      case 35: P.st.world = [0, 1, 2, 3, 4, 5].map((k) => dv.getFloat32(o + 8 + k * 4, true)) as Xform; break;
      case 36: {
        const m = [0, 1, 2, 3, 4, 5].map((k) => dv.getFloat32(o + 8 + k * 4, true)) as Xform;
        const mode = u32(o + 32);
        const w = P.st.world;
        const mul = (a: Xform, b: Xform): Xform => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
        P.st.world = mode === 1 ? [1, 0, 0, 1, 0, 0] : mode === 2 ? mul(m, w) : mode === 3 ? mul(w, m) : mode === 4 ? m : w;
        break;
      }
      case 37: {
        const ih = u32(o + 8);
        const ob = ih & 0x80000000 ? STOCK[ih & 0x7fffffff] : objs[ih];
        if (ob?.pen) P.st.pen = ob.pen;
        if (ob?.brush) P.st.brush = ob.brush;
        if (ob?.font) P.st.font = ob.font;
        break;
      }
      case 38: // CREATEPEN
        objs[u32(o + 8)] = { pen: { color: colorRef(u32(o + 24)), width: i32(o + 16), none: (u32(o + 12) & 15) === 5 } };
        break;
      case 95: // EXTCREATEPEN
        objs[u32(o + 8)] = { pen: { color: colorRef(u32(o + 36)), width: u32(o + 28), none: (u32(o + 24) & 15) === 5 || u32(o + 32) === 1 } };
        break;
      case 39: // CREATEBRUSHINDIRECT
        objs[u32(o + 8)] = { brush: { color: colorRef(u32(o + 16)), none: u32(o + 12) === 1 } };
        break;
      case 93: case 94: // CREATEMONOBRUSH / CREATEDIBPATTERNBRUSHPT: a mid grey stands in for the pattern
        objs[u32(o + 8)] = { brush: { color: "#808080", none: false } };
        break;
      case 82: { // EXTCREATEFONTINDIRECTW
        const f = o + 12;
        objs[u32(o + 8)] = { font: { height: i32(f), escapement: i32(f + 8), weight: i32(f + 16), italic: !!buf[f + 20], underline: !!buf[f + 21], face: utf16(f + 28, 32).replace(/\0.*$/s, "") || "Arial" } };
        break;
      }
      case 40: objs[u32(o + 8)] = null; break; // DELETEOBJECT
      case 42: P.ellipse(i32(o + 8), i32(o + 12), i32(o + 16), i32(o + 20)); break;
      case 43: P.rect(i32(o + 8), i32(o + 12), i32(o + 16), i32(o + 20)); break;
      case 44: P.rect(i32(o + 8), i32(o + 12), i32(o + 16), i32(o + 20), i32(o + 24), i32(o + 28)); break;
      case 59: P.path = []; break; // BEGINPATH
      case 60: break; // ENDPATH
      case 61: if (P.path) P.path.push("Z"); break; // CLOSEFIGURE
      case 62: P.endPath(true, false); break;
      case 63: P.endPath(true, true); break;
      case 64: P.endPath(false, true); break;
      case 68: P.path = null; break; // ABORTPATH
      case 67: P.path = null; break; // SELECTCLIPPATH (clipping is left out)
      case 84: { // EXTTEXTOUTW
        const x = i32(o + 36), y = i32(o + 40), n = u32(o + 44), so = u32(o + 48);
        if (so + n * 2 <= size) P.text(x, y, utf16(o + so, n));
        break;
      }
      case 83: { // EXTTEXTOUTA
        const x = i32(o + 36), y = i32(o + 40), n = u32(o + 44), so = u32(o + 48);
        if (so + n <= size) P.text(x, y, String.fromCharCode(...buf.subarray(o + so, o + so + n)));
        break;
      }
      case 81: { // STRETCHDIBITS
        const xd = i32(o + 24), yd = i32(o + 28), offBmi = u32(o + 48), cbBmi = u32(o + 52), offBits = u32(o + 56), cbBits = u32(o + 60), cxd = i32(o + 72), cyd = i32(o + 76);
        if (cbBmi && offBmi + cbBmi <= size && offBits + cbBits <= size) P.image(xd, yd, cxd, cyd, dibToBmp(buf.slice(o + offBmi, o + offBmi + cbBmi), buf.slice(o + offBits, o + offBits + cbBits)));
        break;
      }
      case 76: { // BITBLT (with a bitmap)
        const xd = i32(o + 24), yd = i32(o + 28), cx = i32(o + 32), cy = i32(o + 36), offBmi = u32(o + 84), cbBmi = u32(o + 88), offBits = u32(o + 92), cbBits = u32(o + 96);
        if (size >= 100 && cbBmi && offBmi + cbBmi <= size && offBits + cbBits <= size) P.image(xd, yd, cx, cy, dibToBmp(buf.slice(o + offBmi, o + offBmi + cbBmi), buf.slice(o + offBits, o + offBits + cbBits)));
        else if (size >= 100 || u32(o + 40) === 0x00f00021) {
          // a pattern fill (PATCOPY) with the current brush
          if (!P.st.brush.none) P.emit(`<rect x="${P.pt(xd, yd)[0]}" y="${P.pt(xd, yd)[1]}" width="${r2(Math.abs(cx * P.scale()[0]))}" height="${r2(Math.abs(cy * P.scale()[1]))}" fill="${P.st.brush.color}"/>`);
        }
        break;
      }
      case 114: // ALPHABLEND (same layout as STRETCHBLT)
      case 77: { // STRETCHBLT
        const xd = i32(o + 24), yd = i32(o + 28), cx = i32(o + 32), cy = i32(o + 36), offBmi = u32(o + 84), cbBmi = u32(o + 88), offBits = u32(o + 92), cbBits = u32(o + 96);
        if (size >= 108 && cbBmi && offBmi + cbBmi <= size && offBits + cbBits <= size) P.image(xd, yd, cx, cy, dibToBmp(buf.slice(o + offBmi, o + offBmi + cbBmi), buf.slice(o + offBits, o + offBits + cbBits)));
        break;
      }
      default:
        break;
    }
    off += size;
  }
  return P.svg(br >= bl && bb >= bt && (br > bl || bb > bt) ? [bl, bt, br - bl + 1, bb - bt + 1] : null);
}

// ------------------------------------------------------------------ WMF

function wmfToSvg(buf: Uint8Array): string | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 0;
  let view: [number, number, number, number] | null = null;
  if (buf.length >= 22 && dv.getUint32(0, true) === 0x9ac6cdd7) {
    const l = dv.getInt16(6, true), t = dv.getInt16(8, true), r = dv.getInt16(10, true), b = dv.getInt16(12, true);
    if (r > l && b > t) view = [l, t, r - l, b - t];
    off = 22;
  }
  if (off + 18 > buf.length) return null;
  const htype = dv.getUint16(off, true), hsize = dv.getUint16(off + 2, true);
  if ((htype !== 1 && htype !== 2) || hsize !== 9) return null;
  off += 18;
  const P = new Painter();
  P.st.mapMode = 0;
  const objs: Obj[] = [];
  const add = (o: Obj) => {
    let k = 0;
    while (objs[k] !== undefined && objs[k] !== null) k++;
    objs[k] = o ?? { };
  };
  const i16 = (o: number) => dv.getInt16(o, true);
  const u16 = (o: number) => dv.getUint16(o, true);
  const u32 = (o: number) => dv.getUint32(o, true);
  const pts = (o: number, n: number) => Array.from({ length: n }, (_, k) => [i16(o + k * 4), i16(o + k * 4 + 2)] as [number, number]);
  const ansi = (o: number, n: number) => {
    const b = buf.subarray(o, Math.min(buf.length, o + n));
    try {
      return new TextDecoder("windows-1252").decode(b);
    } catch {
      return String.fromCharCode(...b);
    }
  };
  let winSet = false;
  for (let guard = 0; off + 6 <= buf.length && guard < 2_000_000; guard++) {
    const size = u32(off) * 2, fn = u16(off + 4), p = off + 6;
    if (size < 6 || off + size > buf.length) break;
    switch (fn) {
      case 0x0000: off = buf.length; continue;
      case 0x020b: P.st.winOrg = [i16(p + 2), i16(p)]; break; // SETWINDOWORG (y, x)
      case 0x020c: P.st.winExt = [i16(p + 2), i16(p)]; winSet = true; break;
      case 0x020d: P.st.vpOrg = [i16(p + 2), i16(p)]; break;
      case 0x020e: P.st.vpExt = [i16(p + 2), i16(p)]; break;
      case 0x0103: break; // SETMAPMODE: drawn in logical units
      case 0x0106: P.st.fillRule = u16(p) === 2 ? "nonzero" : "evenodd"; break;
      case 0x0209: P.st.textColor = colorRef(u32(p)); break;
      case 0x012e: P.st.textAlign = u16(p); break;
      case 0x001e: P.save(); break;
      case 0x0127: P.restore(i16(p)); break;
      case 0x02fa: add({ pen: { color: colorRef(u32(p + 6)), width: i16(p + 2), none: (u16(p) & 15) === 5 } }); break;
      case 0x02fc: add({ brush: { color: colorRef(u32(p + 2)), none: u16(p) === 1 } }); break;
      case 0x02fb: {
        let face = "";
        for (let k = p + 18; k < off + size && buf[k]; k++) face += String.fromCharCode(buf[k]);
        add({ font: { height: i16(p), escapement: i16(p + 4), weight: i16(p + 8), italic: !!buf[p + 10], underline: !!buf[p + 11], face: face || "Arial" } });
        break;
      }
      case 0x0142: case 0x01f9: case 0x00f7: case 0x06ff:
        // pattern brushes, palettes and regions take an object slot
        add(fn === 0x0142 || fn === 0x01f9 ? { brush: { color: "#808080", none: false } } : {});
        break;
      case 0x012d: {
        const ob = objs[u16(p)];
        if (ob?.pen) P.st.pen = ob.pen;
        if (ob?.brush) P.st.brush = ob.brush;
        if (ob?.font) P.st.font = ob.font;
        break;
      }
      case 0x01f0: objs[u16(p)] = null; break;
      case 0x0324: P.poly(pts(p + 2, i16(p)), true, true); break;
      case 0x0325: P.poly(pts(p + 2, i16(p)), false, false); break;
      case 0x0538: {
        const n = u16(p);
        const counts = Array.from({ length: n }, (_, k) => u16(p + 2 + k * 2));
        let q = p + 2 + n * 2;
        const list: [number, number][][] = [];
        for (const c of counts) {
          if (q + c * 4 > off + size) break;
          list.push(pts(q, c));
          q += c * 4;
        }
        P.polys(list, true);
        break;
      }
      case 0x041b: P.rect(i16(p + 6), i16(p + 4), i16(p + 2), i16(p)); break; // RECTANGLE (bottom, right, top, left)
      case 0x0418: P.ellipse(i16(p + 6), i16(p + 4), i16(p + 2), i16(p)); break;
      case 0x061c: P.rect(i16(p + 10), i16(p + 8), i16(p + 6), i16(p + 4), i16(p + 2), i16(p)); break;
      case 0x0214: P.moveTo(i16(p + 2), i16(p)); break;
      case 0x0213: P.line(i16(p + 2), i16(p)); break;
      case 0x0521: { // TEXTOUT
        const n = i16(p);
        const sl = n + (n & 1);
        P.text(i16(p + 2 + sl + 2), i16(p + 2 + sl), ansi(p + 2, n));
        break;
      }
      case 0x0a32: { // EXTTEXTOUT
        const y = i16(p), x = i16(p + 2), n = i16(p + 4), opts = u16(p + 6);
        const so = p + 8 + (opts & 6 ? 8 : 0);
        P.text(x, y, ansi(so, n));
        break;
      }
      case 0x0f43: { // STRETCHDIB
        const dh = i16(p + 14), dw = i16(p + 16), yd = i16(p + 18), xd = i16(p + 20);
        P.image(xd, yd, dw, dh, dibToBmp(buf.slice(p + 22, off + size)));
        break;
      }
      case 0x0b41: { // DIBSTRETCHBLT
        if (size > 6 + 20) {
          const dh = i16(p + 12), dw = i16(p + 14), yd = i16(p + 16), xd = i16(p + 18);
          P.image(xd, yd, dw, dh, dibToBmp(buf.slice(p + 20, off + size)));
        }
        break;
      }
      case 0x0940: { // DIBBITBLT
        if (size > 6 + 16) {
          const h = i16(p + 8), w = i16(p + 10), yd = i16(p + 12), xd = i16(p + 14);
          P.image(xd, yd, w, h, dibToBmp(buf.slice(p + 16, off + size)));
        }
        break;
      }
      default:
        break;
    }
    off += size;
  }
  if (!view && winSet) {
    const [ox, oy] = P.st.winOrg, [ex, ey] = P.st.winExt;
    view = [Math.min(ox, ox + ex), Math.min(oy, oy + ey), Math.abs(ex), Math.abs(ey)];
  }
  return P.svg(view);
}

/** An EMF or WMF picture as SVG markup, or null when it holds nothing drawable here. */
export function metafileToSvg(bytes: Uint8Array): string | null {
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length >= 44 && dv.getUint32(0, true) === 1 && dv.getUint32(40, true) === 0x464d4520) return emfToSvg(bytes);
    return wmfToSvg(bytes);
  } catch {
    return null;
  }
}

/** A grey box naming the format, for a metafile that cannot be drawn here (the original is kept for export). */
export function metafilePlaceholder(ext: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90" preserveAspectRatio="none"><rect width="160" height="90" fill="#f1f5f9" stroke="#94a3b8"/><text x="80" y="50" font-family="Arial" font-size="12" fill="#64748b" text-anchor="middle">${esc(ext.toUpperCase())} picture</text></svg>`;
}
