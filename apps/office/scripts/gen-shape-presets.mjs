// Builds lib/shape-presets.json, the outlines of all 187 DrawingML preset
// shapes (Excel's and PowerPoint's Insert > Shapes), from LibreOffice's
// table of them (share/filter/oox-drawingml-cs-presets, MPL-2.0; the shapes
// themselves are defined by ECMA-376). Each preset keeps its adjustment
// defaults, guide formulas (LibreOffice's syntax), path commands and points,
// and text box; lib/shape-presets.ts draws them.
//
//   node scripts/gen-shape-presets.mjs [/usr/lib/libreoffice/share/filter/oox-drawingml-cs-presets]
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync(process.argv[2] || "/usr/lib/libreoffice/share/filter/oox-drawingml-cs-presets", "utf8");
const out = {};
const param = (body) => {
  const v = /Value = \(any\) \{ \((?:long|double)\) (-?[\d.]+) \}/.exec(body);
  const t = /Type = \(short\) (\d+)/.exec(body);
  const n = Number(v?.[1] ?? 0);
  const type = Number(t?.[1] ?? 0);
  return type === 1 ? `?${n}` : type === 2 ? `$${n}` : n;
};
// "First = (...) { ... }, Second = (...) { ... }" pairs
const pairs = (text) => [...text.matchAll(/First = \(com\.sun\.star\.drawing\.EnhancedCustomShapeParameter\) \{([^}]*\}[^}]*)\}, Second = \(com\.sun\.star\.drawing\.EnhancedCustomShapeParameter\) \{([^}]*\}[^}]*)\}/g)].map((m) => [param(m[1]), param(m[2])]);
for (const block of src.split(/^\/\* /m).slice(1)) {
  const name = /^(\S+) \*\//.exec(block)?.[1];
  if (!name) continue;
  const field = (key) => new RegExp(`^${key}\\n(.*)$`, "m").exec(block)?.[1] || "";
  const adj = [...field("AdjustmentValues").matchAll(/Value = \(any\) \{ \((?:long|double)\) (-?[\d.]+) \}, State = [^,]*, Name = "([^"]*)"/g)].map((m) => [m[2], Number(m[1])]);
  const eqs = [...field("Equations").matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\s+/g, ""));
  const path = field("Path");
  const coordsText = /Name = "Coordinates"[\s\S]*?\} \} \}, State/.exec(path)?.[0] || "";
  const coords = pairs(coordsText);
  const segments = [...(/Name = "Segments"[\s\S]*?State/.exec(path)?.[0] || "").matchAll(/Command = \(short\) (\d+), Count = \(short\) (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const views = [...(/Name = "SubViewSize"[\s\S]*?State/.exec(path)?.[0] || "").matchAll(/Width = \(long\) (\d+), Height = \(long\) (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const tf = /Name = "TextFrames"[\s\S]*?State/.exec(path)?.[0] || "";
  const text = pairs(tf);
  const entry = { e: eqs, c: coords, s: segments };
  if (adj.length) entry.a = adj;
  if (views.length && views.some(([w, h]) => w || h)) entry.v = views;
  if (text.length >= 2) entry.t = [text[0], text[1]];
  out[name] = entry;
}
const file = new URL("../lib/shape-presets.json", import.meta.url);
writeFileSync(file, JSON.stringify(out));
console.log(Object.keys(out).length, "presets,", readFileSync(file).length, "bytes");
