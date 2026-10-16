// WordArt Transform: text warped along a path (arches, circle, curves, waves,
// chevrons) or tilted (slants, fades), as PowerPoint's preset text warps
// (a:prstTxWarp). Warps PowerPoint has that we cannot draw are kept for the
// round trip and drawn as plain text.

export type WarpKind = { id: string; label: string; path?: (w: number, h: number) => string; css?: string };

const f = (n: number) => Math.round(n * 100) / 100;

export const WARPS: WarpKind[] = [
  { id: "textArchUp", label: "Arch", path: (w, h) => `M${f(w * 0.04)} ${f(h * 0.92)} A${f(w * 0.46)} ${f(h * 0.82)} 0 0 1 ${f(w * 0.96)} ${f(h * 0.92)}` },
  { id: "textArchDown", label: "Arch: Down", path: (w, h) => `M${f(w * 0.04)} ${f(h * 0.2)} A${f(w * 0.46)} ${f(h * 0.7)} 0 0 0 ${f(w * 0.96)} ${f(h * 0.2)}` },
  {
    id: "textCircle",
    label: "Circle",
    path: (w, h) => `M${f(w * 0.08)} ${f(h / 2)} A${f(w * 0.42)} ${f(h * 0.42)} 0 1 1 ${f(w * 0.92)} ${f(h / 2)} A${f(w * 0.42)} ${f(h * 0.42)} 0 1 1 ${f(w * 0.08)} ${f(h / 2)}`,
  },
  { id: "textCurveUp", label: "Curve: Up", path: (w, h) => `M0 ${f(h * 0.85)} C${f(w * 0.35)} ${f(h * 0.85)} ${f(w * 0.65)} ${f(h * 0.3)} ${f(w)} ${f(h * 0.3)}` },
  { id: "textCurveDown", label: "Curve: Down", path: (w, h) => `M0 ${f(h * 0.3)} C${f(w * 0.35)} ${f(h * 0.3)} ${f(w * 0.65)} ${f(h * 0.85)} ${f(w)} ${f(h * 0.85)}` },
  { id: "textWave1", label: "Wave", path: (w, h) => `M0 ${f(h * 0.6)} C${f(w * 0.25)} ${f(h * 0.15)} ${f(w * 0.25)} ${f(h * 1.05)} ${f(w * 0.5)} ${f(h * 0.6)} S${f(w * 0.75)} ${f(h * 0.15)} ${f(w)} ${f(h * 0.6)}` },
  { id: "textChevron", label: "Chevron: Up", path: (w, h) => `M0 ${f(h * 0.85)} L${f(w / 2)} ${f(h * 0.45)} L${f(w)} ${f(h * 0.85)}` },
  { id: "textChevronInverted", label: "Chevron: Down", path: (w, h) => `M0 ${f(h * 0.45)} L${f(w / 2)} ${f(h * 0.85)} L${f(w)} ${f(h * 0.45)}` },
  { id: "textSlantUp", label: "Slant: Up", css: "skewY(-12deg)" },
  { id: "textSlantDown", label: "Slant: Down", css: "skewY(12deg)" },
  { id: "textFadeRight", label: "Fade: Right", css: "perspective(500px) rotateY(-35deg)" },
  { id: "textFadeLeft", label: "Fade: Left", css: "perspective(500px) rotateY(35deg)" },
  { id: "textFadeUp", label: "Fade: Up", css: "perspective(500px) rotateX(35deg)" },
  { id: "textFadeDown", label: "Fade: Down", css: "perspective(500px) rotateX(-35deg)" },
];

/** Every preset name PowerPoint can write (ST_TextShapeType); others are dropped on import. */
const OOXML_WARPS = new Set(
  "textNoShape textPlain textStop textTriangle textTriangleInverted textChevron textChevronInverted textRingInside textRingOutside textArchUp textArchDown textCircle textButton textArchUpPour textArchDownPour textCirclePour textButtonPour textCurveUp textCurveDown textCanUp textCanDown textWave1 textWave2 textDoubleWave1 textWave4 textInflate textDeflate textInflateBottom textDeflateBottom textInflateTop textDeflateTop textDeflateInflate textDeflateInflateDeflate textFadeRight textFadeLeft textFadeUp textFadeDown textSlantUp textSlantDown textCascadeUp textCascadeDown".split(" "),
);

/** A warp worth keeping: a known preset other than none/plain. */
export function validWarp(v: unknown): v is string {
  return typeof v === "string" && OOXML_WARPS.has(v) && v !== "textNoShape" && v !== "textPlain";
}

export const warpOf = (id: string | undefined) => (id ? WARPS.find((x) => x.id === id) : undefined);

/** The first run's look in some text HTML: size (px), colour, bold, italic, font. */
export function firstRunStyle(html: string): { px?: number; color?: string; bold: boolean; italic: boolean; font?: string } {
  const pt = /font-size:\s*([\d.]+)pt/i.exec(html)?.[1];
  const px = /font-size:\s*([\d.]+)px/i.exec(html)?.[1];
  const color = /(?:^|[;"\s])color:\s*#?([0-9a-f]{6})\b/i.exec(html)?.[1];
  const font = /font-family:\s*([^;"]+)/i.exec(html)?.[1]?.trim();
  return {
    ...(pt ? { px: (Number(pt) * 4) / 3 } : px ? { px: Number(px) } : {}),
    ...(color ? { color: color.toUpperCase() } : {}),
    bold: /<(b|strong)\b|font-weight:\s*(bold|[6-9]00)/i.test(html),
    italic: /<(i|em)\b|font-style:\s*italic/i.test(html),
    ...(font ? { font } : {}),
  };
}

/** The bodyPr with a preset text warp as its first child (where the schema wants it); none removes it. */
export function setBodyWarp(bodyPr: string, warp: string | undefined): string {
  const m = /^<a:bodyPr\b([^>]*?)(\/>|>([\s\S]*?)<\/a:bodyPr>)$/.exec(bodyPr);
  if (!m) return bodyPr;
  const inner = (m[3] ?? "").replace(/<a:prstTxWarp\b[^>]*\/>|<a:prstTxWarp\b[\s\S]*?<\/a:prstTxWarp>/g, "");
  const w = warp && validWarp(warp) ? `<a:prstTxWarp prst="${warp}"><a:avLst/></a:prstTxWarp>` : "";
  return w || inner ? `<a:bodyPr${m[1]}>${w}${inner}</a:bodyPr>` : `<a:bodyPr${m[1]}/>`;
}
