// Gradient fills, outer shadows and picture crops: CSS for the renderer and
// DrawingML for the .pptx exporter (the importer reads them back with
// readGradient/readShadow/readCrop).
import { setBodyWarp } from "./warp";
import type { Crop, Gradient, Shadow, WordArt } from "./model";
import { custGeomXml, type Geom } from "./freeform";

const HEX = /^[0-9a-f]{6}$/i;
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const r2 = (n: number) => Math.round(n * 100) / 100;

export function validGradient(g: Gradient | undefined): g is Gradient {
  return !!g && Array.isArray(g.stops) && g.stops.length >= 2 && g.stops.every((s) => HEX.test(s.color) && Number.isFinite(s.pos));
}

const sorted = (g: Gradient) => [...g.stops].sort((a, b) => a.pos - b.pos);

/** CSS background-image for a gradient (OOXML angle 0 = left to right; CSS 90deg = to right). */
export function gradientCss(g: Gradient): string {
  const stops = sorted(g).map((s) => `#${s.color} ${r2(clamp(s.pos, 0, 100))}%`).join(", ");
  return g.kind === "radial" ? `radial-gradient(circle at 50% 50%, ${stops})` : `linear-gradient(${r2(g.angle + 90)}deg, ${stops})`;
}

/** Vector of the linear gradient in objectBoundingBox units (for SVG). */
export function gradientVector(angle: number): { x1: number; y1: number; x2: number; y2: number } {
  const a = (angle * Math.PI) / 180;
  const dx = Math.cos(a) / 2, dy = Math.sin(a) / 2;
  return { x1: r2(0.5 - dx), y1: r2(0.5 - dy), x2: r2(0.5 + dx), y2: r2(0.5 + dy) };
}

export function shadowOffset(s: Shadow): { dx: number; dy: number } {
  const a = (s.dir * Math.PI) / 180;
  return { dx: r2(Math.cos(a) * s.dist), dy: r2(Math.sin(a) * s.dist) };
}

/** CSS filter for an outer shadow. */
export function shadowCss(s: Shadow | undefined): string | undefined {
  if (!s || !HEX.test(s.color)) return undefined;
  const { dx, dy } = shadowOffset(s);
  const n = parseInt(s.color, 16);
  return `drop-shadow(${dx}px ${dy}px ${r2(s.blur / 2)}px rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${clamp(s.alpha, 0, 1)}))`;
}

export function hasCrop(c: Crop | undefined): c is Crop {
  return !!c && (c.l > 0 || c.t > 0 || c.r > 0 || c.b > 0) && c.l + c.r < 1 && c.t + c.b < 1;
}

/** Placement of the whole (uncropped) picture inside the element's box, in %. */
export function cropBox(c: Crop): { left: string; top: string; width: string; height: string } {
  const w = 1 - c.l - c.r, h = 1 - c.t - c.b;
  const pc = (n: number) => `${r2(n * 100)}%`;
  return { left: pc(-c.l / w), top: pc(-c.t / h), width: pc(1 / w), height: pc(1 / h) };
}

// ------------------------------------------------------------- DrawingML

const EMU_PER_PX = 9525;

export function gradFillXml(g: Gradient): string {
  const gs = sorted(g)
    .map((s) => `<a:gs pos="${Math.round(clamp(s.pos, 0, 100) * 1000)}"><a:srgbClr val="${s.color.toUpperCase()}"/></a:gs>`)
    .join("");
  const shade = g.kind === "radial"
    ? '<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>'
    : `<a:lin ang="${Math.round((((g.angle % 360) + 360) % 360) * 60000)}" scaled="0"/>`;
  return `<a:gradFill rotWithShape="1"><a:gsLst>${gs}</a:gsLst>${shade}</a:gradFill>`;
}

export function shadowXml(s: Shadow): string {
  return `<a:effectLst><a:outerShdw blurRad="${Math.round(s.blur * EMU_PER_PX)}" dist="${Math.round(s.dist * EMU_PER_PX)}" dir="${Math.round((((s.dir % 360) + 360) % 360) * 60000)}" algn="ctr" rotWithShape="0"><a:srgbClr val="${s.color.toUpperCase()}"><a:alpha val="${Math.round(clamp(s.alpha, 0, 1) * 100000)}"/></a:srgbClr></a:outerShdw></a:effectLst>`;
}

export function srcRectXml(c: Crop): string {
  const v = (n: number) => Math.round(n * 100000);
  return `<a:srcRect l="${v(c.l)}" t="${v(c.t)}" r="${v(c.r)}" b="${v(c.b)}"/>`;
}

export type ShapeFx = { warp?: string; grad?: Gradient; shadow?: Shadow; crop?: Crop; geom?: Geom; lineA?: number; fillA?: number; cols?: number; colGap?: number; wa?: WordArt };

/** CSS for WordArt effects on a block of text. */
export function wordArtCss(wa: WordArt | undefined): Record<string, string | undefined> {
  if (!wa) return {};
  const out: Record<string, string | undefined> = {};
  if (wa.stroke && HEX.test(wa.stroke.c)) {
    out.WebkitTextStroke = `${r2(clamp(wa.stroke.w, 0, 20))}px #${wa.stroke.c}`;
    out.paintOrder = "stroke fill";
  }
  const shadows: string[] = [];
  if (wa.shadow && HEX.test(wa.shadow.color)) {
    const { dx, dy } = shadowOffset(wa.shadow);
    const n = parseInt(wa.shadow.color, 16);
    shadows.push(`${dx}px ${dy}px ${r2(wa.shadow.blur)}px rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${clamp(wa.shadow.alpha, 0, 1)})`);
  }
  if (wa.glow && HEX.test(wa.glow.c)) shadows.push(`0 0 ${r2(wa.glow.r)}px #${wa.glow.c}`, `0 0 ${r2(wa.glow.r / 2)}px #${wa.glow.c}`);
  if (shadows.length) out.textShadow = shadows.join(", ");
  if (wa.grad && validGradient(wa.grad)) {
    out.backgroundImage = gradientCss(wa.grad);
    out.WebkitBackgroundClip = "text";
    out.backgroundClip = "text";
    out.WebkitTextFillColor = "transparent";
    // a gradient behind clipped text cannot also show a shadow under the letters
    if (shadows.length) out.filter = `drop-shadow(${shadows[0]})`;
    if (shadows.length) out.textShadow = undefined;
  }
  return out;
}

/** WordArt effects written into one run's properties (ln, fill, effectLst first, in schema order). */
export function patchRunProps(rpr: string, wa: WordArt): string {
  const m = /^<a:rPr\b([^>]*?)(?:\/>|>([\s\S]*?)<\/a:rPr>)$/.exec(rpr);
  if (!m) return rpr;
  let inner = m[2] ?? "";
  inner = inner.replace(/<a:ln\b[^>]*\/>|<a:ln\b[\s\S]*?<\/a:ln>/, "").replace(/<a:effectLst\/>|<a:effectLst>[\s\S]*?<\/a:effectLst>/, "");
  let fill = "";
  const fm = /<a:noFill\/>|<a:(solidFill|gradFill)\b[\s\S]*?<\/a:\1>/.exec(inner);
  if (fm) {
    fill = fm[0];
    inner = inner.replace(fm[0], "");
  }
  if (wa.grad && validGradient(wa.grad)) fill = gradFillXml(wa.grad).replace(' rotWithShape="1"', "");
  const ln = wa.stroke && HEX.test(wa.stroke.c) ? `<a:ln w="${Math.round(clamp(wa.stroke.w, 0, 20) * EMU_PER_PX)}"><a:solidFill><a:srgbClr val="${wa.stroke.c.toUpperCase()}"/></a:solidFill></a:ln>` : "";
  const glow = wa.glow && HEX.test(wa.glow.c) ? `<a:glow rad="${Math.round(wa.glow.r * EMU_PER_PX)}"><a:srgbClr val="${wa.glow.c.toUpperCase()}"><a:alpha val="60000"/></a:srgbClr></a:glow>` : "";
  const shadow = wa.shadow && HEX.test(wa.shadow.color) ? shadowXml(wa.shadow).replace(/^<a:effectLst>|<\/a:effectLst>$/g, "") : "";
  const eff = glow || shadow ? `<a:effectLst>${glow}${shadow}</a:effectLst>` : "";
  return `<a:rPr${m[1]}>${ln}${fill}${eff}${inner}</a:rPr>`;
}

/** Patch the spPr/blipFill of one <p:sp> or <p:pic> fragment. */
export function patchShapeXml(frag: string, fx: ShapeFx): string {
  let out = frag;
  if (fx.geom) {
    out = out.replace(/<a:prstGeom\b[^>]*\/>|<a:prstGeom\b[^>]*>[\s\S]*?<\/a:prstGeom>/, custGeomXml(fx.geom));
    // freeforms (pen strokes, icons) are drawn with round caps and joins
    out = out.replace(/<a:ln\b([^>]*?)>([\s\S]*?)<\/a:ln>/, (m, attrs: string, inner: string) => {
      if (attrs.endsWith("/")) return m;
      const cap = /\bcap=/.test(attrs) ? attrs : `${attrs} cap="rnd"`;
      let body = inner.replace(/<a:(bevel|miter|round)\b[^>]*\/>/g, "");
      const at = body.search(/<a:headEnd|<a:tailEnd|<a:extLst/);
      body = at >= 0 ? `${body.slice(0, at)}<a:round/>${body.slice(at)}` : `${body}<a:round/>`;
      return `<a:ln${cap}>${body}</a:ln>`;
    });
  }
  // outline opacity: alpha on the line colour
  if (fx.lineA !== undefined && fx.lineA < 1)
    out = out.replace(/(<a:ln\b[^>]*>[\s\S]*?<a:srgbClr val="[0-9A-Fa-f]{6}")(\s*\/>|>)/, (_, head: string, end: string) => `${head}><a:alpha val="${Math.round(Math.max(0, fx.lineA!) * 100000)}"/>${end.trim() === ">" ? "" : "</a:srgbClr>"}`);
  const spPr = /<p:spPr(?:\s[^>]*)?>([\s\S]*?)<\/p:spPr>/;
  if (fx.grad && validGradient(fx.grad)) {
    out = out.replace(spPr, (m, inner: string) => {
      // drop the fill that sits directly in spPr (not the outline's)
      const ln = inner.indexOf("<a:ln");
      const head = ln >= 0 ? inner.slice(0, ln) : inner;
      const tail = ln >= 0 ? inner.slice(ln) : "";
      const cleaned = head.replace(/<a:solidFill>[\s\S]*?<\/a:solidFill>|<a:noFill\/>|<a:gradFill[\s\S]*?<\/a:gradFill>/, "");
      const at = cleaned.search(/<\/a:prstGeom>|<\/a:custGeom>/);
      const geoEnd = at >= 0 ? cleaned.indexOf(">", at) + 1 : cleaned.length;
      return m.replace(inner, cleaned.slice(0, geoEnd) + gradFillXml(fx.grad!) + cleaned.slice(geoEnd) + tail);
    });
  }
  // fill transparency: alpha on every colour of the shape's own fill (solid or gradient)
  if (fx.fillA !== undefined && fx.fillA < 1) {
    const alpha = `<a:alpha val="${Math.round(clamp(fx.fillA, 0, 1) * 100000)}"/>`;
    out = out.replace(spPr, (m, inner: string) => {
      const ln = inner.indexOf("<a:ln");
      const head = ln >= 0 ? inner.slice(0, ln) : inner;
      const tail = ln >= 0 ? inner.slice(ln) : "";
      const withA = head.replace(/<a:(solidFill|gradFill)\b[\s\S]*?<\/a:\1>/, (f) =>
        f
          .replace(/<a:alpha val="\d+"\/>/g, "")
          .replace(/<a:(srgbClr|schemeClr|prstClr) val="([^"]+)"\s*\/>/g, `<a:$1 val="$2">${alpha}</a:$1>`)
          .replace(/<a:(srgbClr|schemeClr|prstClr) val="([^"]+)">(?!<a:alpha)/g, `<a:$1 val="$2">${alpha}`),
      );
      return m.replace(inner, withA + tail);
    });
  }
  if (fx.shadow) {
    out = out.replace(spPr, (m, inner: string) => m.replace(inner, inner.replace(/<a:effectLst>[\s\S]*?<\/a:effectLst>|<a:effectLst\/>/, "") + shadowXml(fx.shadow!)));
  }
  if (fx.cols && fx.cols > 1)
    out = out.replace(/<a:bodyPr\b([^>]*?)(\/?)>/, (_m, attrs: string, close: string) => `<a:bodyPr${attrs.replace(/\s(numCol|spcCol)="[^"]*"/g, "")} numCol="${Math.min(16, Math.round(fx.cols!))}" spcCol="${Math.round((fx.colGap ?? 24) * EMU_PER_PX)}"${close}>`);
  if (fx.warp) out = out.replace(/<a:bodyPr\b[^>]*\/>|<a:bodyPr\b[^>]*>[\s\S]*?<\/a:bodyPr>/, (b) => setBodyWarp(b, fx.warp));
  if (fx.wa) out = out.replace(/<a:rPr\b[^>]*\/>|<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/g, (r) => patchRunProps(r, fx.wa!));
  if (fx.crop && hasCrop(fx.crop)) {
    out = out
      .replace(/<a:srcRect[^>]*\/>/, "")
      .replace(/(<a:blip\b[^>]*\/>|<a:blip\b[^>]*>[\s\S]*?<\/a:blip>)/, `$1${srcRectXml(fx.crop)}`);
  }
  return out;
}

/** Apply effects to every shape/picture in a part whose cNvPr name is in `byName`. */
export function patchPartEffects(xml: string, byName: Map<string, ShapeFx>): string {
  if (!byName.size) return xml;
  return xml.replace(/<p:(sp|pic)>[\s\S]*?<\/p:\1>/g, (frag) => {
    const name = /<p:cNvPr [^>]*name="([^"]*)"/.exec(frag)?.[1];
    const fx = name ? byName.get(name) : undefined;
    return fx ? patchShapeXml(frag, fx) : frag;
  });
}

/** The slide background as a gradient (replaces whatever <p:bg> PptxGenJS wrote). */
export function patchBackgroundGradient(xml: string, g: Gradient): string {
  const bg = `<p:bg><p:bgPr>${gradFillXml(g)}<a:effectLst/></p:bgPr></p:bg>`;
  if (/<p:bg>[\s\S]*?<\/p:bg>/.test(xml)) return xml.replace(/<p:bg>[\s\S]*?<\/p:bg>/, bg);
  return xml.replace(/<p:cSld([^>]*)>/, `<p:cSld$1>${bg}`);
}

/** The colour a gradient has at `pos` (0-100), for a stop added there. */
export function colorAt(stops: Gradient["stops"], pos: number): string {
  const s = [...stops].sort((a, b) => a.pos - b.pos);
  if (!s.length) return "FFFFFF";
  if (pos <= s[0].pos) return s[0].color;
  for (let i = 1; i < s.length; i++)
    if (pos <= s[i].pos) {
      const a = s[i - 1], b = s[i];
      const t = b.pos === a.pos ? 0 : (pos - a.pos) / (b.pos - a.pos);
      const ch = (h: string, k: number) => parseInt(h.slice(k, k + 2), 16);
      return [0, 2, 4].map((k) => Math.round(ch(a.color, k) + (ch(b.color, k) - ch(a.color, k)) * t).toString(16).padStart(2, "0")).join("").toUpperCase();
    }
  return s[s.length - 1].color;
}
