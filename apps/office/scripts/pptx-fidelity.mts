// Round-trip fidelity check for .pptx files: each deck is imported, exported
// again, and both packages are measured the same way straight from their XML
// (slides, words of slide text and notes, pictures, tables, charts, shapes,
// groups), so losses show as recall below 100%.
//
//   npx tsx scripts/pptx-fidelity.mts <dir or file>... [--json out.json] [--out dir]
//
// --out keeps each exported deck for a look in PowerPoint or LibreOffice.
// The files are only read as data; nothing in them is run.
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>");
const g = globalThis as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
g.DOMParser = dom.window.DOMParser;
g.XMLSerializer = dom.window.XMLSerializer;

type Counts = { slides: number; words: string[]; notes: string[]; pics: number; tables: number; charts: number; shapes: number; groups: number; media: number };

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m));
// runs of a paragraph join without a space (a word can be split across runs)
const words = (xml: string) =>
  (xml.match(/<a:p>[\s\S]*?<\/a:p>/g) || [])
    .map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>|<a:t [^>]*>([^<]*)<\/a:t>/g)].map((m) => decode(m[1] ?? m[2] ?? "")).join(""))
    .join(" ")
    .toLowerCase()
    .split(/[\s ]+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
const count = (xml: string, re: RegExp) => (xml.match(re) || []).length;

/** Resolve a relationship target against the part that holds it. */
const resolve = (from: string, target: string) => path.posix.normalize(path.posix.join(path.posix.dirname(from), target)).replace(/^\//, "");

async function measure(data: Uint8Array | ArrayBuffer): Promise<Counts> {
  const zip = await JSZip.loadAsync(data);
  const read = async (p: string) => (await zip.file(p)?.async("string")) || "";
  const pres = await read("ppt/presentation.xml");
  const presRels = await read("ppt/_rels/presentation.xml.rels");
  const rel = (xml: string) => new Map([...xml.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1] || "", { target: /Target="([^"]+)"/.exec(m[0])?.[1] || "", type: /Type="([^"]+)"/.exec(m[0])?.[1] || "" }]));
  const pr = rel(presRels);
  const ids = [...pres.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map((m) => m[1]);
  const out: Counts = { slides: 0, words: [], notes: [], pics: 0, tables: 0, charts: 0, shapes: 0, groups: 0, media: 0 };
  for (const id of ids) {
    const t = pr.get(id);
    if (!t) continue;
    const p = resolve("ppt/presentation.xml", t.target);
    const xml = await read(p);
    if (!xml) continue;
    out.slides++;
    out.words.push(...words(xml));
    out.pics += count(xml, /<p:pic>/g);
    out.tables += count(xml, /<a:tbl>/g);
    out.charts += count(xml, /<c:chart\b/g);
    // shapes, leaving out empty placeholders (only seen while editing)
    // shapes, leaving out empty placeholders (only seen while editing) and empty shapes with no fill or line
    const hasText = (sp: string) => /<a:t>[^<]*\S|<a:t [^>]*>[^<]*\S/.test(sp);
    const invisible = (sp: string) => /<p:spPr\b[^>]*>(?:(?!<\/p:spPr>)[\s\S])*?<\/a:prstGeom><a:noFill\/><a:ln[^>]*><a:noFill\/>/.test(sp);
    out.shapes += (xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []).filter((sp) => hasText(sp) || (!/<p:ph\b/.test(sp) && !invisible(sp))).length + count(xml, /<p:cxnSp>/g);
    out.groups += count(xml, /<p:grpSp>/g);
    out.media += count(xml, /<a:(videoFile|audioFile)\b|<p14:media\b/g);
    const sr = rel(await read(p.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels")));
    const notes = [...sr.values()].find((r) => r.type.endsWith("/notesSlide"));
    if (notes) {
      // the notes body placeholder only (not the slide image or number)
      const nx = await read(resolve(p, notes.target));
      for (const sp of nx.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []) if (/<p:ph [^>]*type="body"/.test(sp)) out.notes.push(...words(sp));
    }
  }
  return out;
}

/** Share of `src` words (with repeats) found in `dst`. */
function recall(src: string[], dst: string[]): number {
  if (!src.length) return 1;
  const bag = new Map<string, number>();
  for (const w of dst) bag.set(w, (bag.get(w) || 0) + 1);
  let hit = 0;
  for (const w of src) {
    const n = bag.get(w) || 0;
    if (n > 0) {
      hit++;
      bag.set(w, n - 1);
    }
  }
  return hit / src.length;
}

type Row = { file: string; ok: boolean; error?: string; ms: number; warningText?: string[]; src?: Omit<Counts, "words" | "notes"> & { words: number; notes: number }; out?: Omit<Counts, "words" | "notes"> & { words: number; notes: number }; text?: number; notesRecall?: number; warnings?: number; missing?: string[] };

const files: string[] = [];
const args = process.argv.slice(2);
let json: string | undefined;
let outDir: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--json") json = args[++i];
  else if (args[i] === "--out") outDir = args[++i];
  else {
    const p = args[i];
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p).sort()) if (/\.pptx$/i.test(f)) files.push(path.join(p, f));
    } else files.push(p);
  }
}
if (outDir) mkdirSync(outDir, { recursive: true });

const { importPptx } = await import("../lib/slides/pptx-import");
const { buildPptx } = await import("../lib/slides/pptx-export");
const rows: Row[] = [];
for (const file of files) {
  const t0 = Date.now();
  const row: Row = { file: path.relative(process.cwd(), file), ok: false, ms: 0 };
  try {
    const bytes = readFileSync(file);
    const src = await measure(bytes);
    const deck = await importPptx(bytes);
    const back = await buildPptx(deck.slides, { name: path.basename(file), w: deck.w, h: deck.h, theme: deck.theme, font: deck.font, headFont: deck.headFont, colors: deck.colors, hf: deck.hf, masters: deck.masters, show: deck.show, shows: deck.shows });
    if (outDir) writeFileSync(path.join(outDir, path.basename(file)), Buffer.from(back));
    const out = await measure(back);
    const strip = (c: Counts) => ({ ...c, words: c.words.length, notes: c.notes.length });
    Object.assign(row, { ok: true, src: strip(src), out: strip(out), text: recall(src.words, out.words), notesRecall: recall(src.notes, out.notes), warnings: deck.warnings.length, warningText: deck.warnings });
    // which source words went missing (a sample), to find what loses them
    const bag = new Map<string, number>();
    for (const w of out.words) bag.set(w, (bag.get(w) || 0) + 1);
    row.missing = src.words.filter((w) => { const n = bag.get(w) || 0; if (n) bag.set(w, n - 1); return !n; }).slice(0, 12);
  } catch (e) {
    row.error = (e as Error).message.slice(0, 160);
  }
  row.ms = Date.now() - t0;
  rows.push(row);
  const s = row.src, o = row.out;
  console.log(
    row.ok
      ? `${row.file}\tslides ${s!.slides}->${o!.slides}\ttext ${(row.text! * 100).toFixed(1)}%\tnotes ${(row.notesRecall! * 100).toFixed(0)}%\tpics ${s!.pics}->${o!.pics}\ttables ${s!.tables}->${o!.tables}\tcharts ${s!.charts}->${o!.charts}\tshapes ${s!.shapes}->${o!.shapes}\t${row.ms}ms${row.missing?.length ? `\tmissing: ${row.missing.join(" ")}` : ""}`
      : `${row.file}\tFAILED: ${row.error}`,
  );
}
const ok = rows.filter((r) => r.ok);
const sum = (f: (r: Row) => number) => ok.reduce((a, r) => a + f(r), 0);
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "n/a");
console.log(
  `\n${rows.length} files, ${ok.length} round-tripped; slides ${sum((r) => r.out!.slides)}/${sum((r) => r.src!.slides)}; ` +
    `text words ${pct(sum((r) => r.text! * r.src!.words), sum((r) => r.src!.words))}; notes words ${pct(sum((r) => r.notesRecall! * r.src!.notes), sum((r) => r.src!.notes))}; ` +
    `pictures ${sum((r) => Math.min(r.out!.pics, r.src!.pics))}/${sum((r) => r.src!.pics)}; tables ${sum((r) => Math.min(r.out!.tables, r.src!.tables))}/${sum((r) => r.src!.tables)}; ` +
    `charts ${sum((r) => Math.min(r.out!.charts, r.src!.charts))}/${sum((r) => r.src!.charts)}; shapes ${sum((r) => Math.min(r.out!.shapes, r.src!.shapes))}/${sum((r) => r.src!.shapes)}; groups ${sum((r) => Math.min(r.out!.groups, r.src!.groups))}/${sum((r) => r.src!.groups)}; media ${sum((r) => Math.min(r.out!.media, r.src!.media))}/${sum((r) => r.src!.media)}`,
);
// what the importer said it could not carry over, by how many files
const said = new Map<string, number>();
for (const r of ok) for (const w of r.warningText || []) said.set(w, (said.get(w) || 0) + 1);
for (const [w, n] of [...said].sort((a, b) => b[1] - a[1])) console.log(`${n}\t${w}`);
if (json) writeFileSync(json, JSON.stringify(rows, null, 1));
