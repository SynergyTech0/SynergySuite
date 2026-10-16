// Round-trip fidelity check for .docx files: each document is imported,
// exported again, and both packages are measured the same way straight from
// their XML (paragraphs, words of body text, headers and footers, notes and
// comments, tables, pictures, charts, SmartArt, equations, lists, fields,
// hyperlinks, tracked changes, content controls, sections), so losses show as
// counts going down and recall below 100%.
//
//   npx tsx scripts/docx-fidelity.mts <dir or file>... [--json out.json] [--out dir]
//
// --out keeps each exported document for a look in Word or LibreOffice.
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

const KEYS = ["paras", "tables", "pics", "charts", "smartart", "math", "lists", "fields", "links", "changes", "sdts", "sections", "comments", "notes"] as const;
type Key = (typeof KEYS)[number];
type Counts = Record<Key, number> & { body: string[]; hf: string[]; noteWords: string[]; commentWords: string[] };

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m));
/** Words of the text runs (w:t, not deleted text or field codes); runs of a paragraph join without a space. */
const words = (xml: string) =>
  xml
    .split(/<\/w:p>/)
    .map((p) => [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => decode(m[1])).join(""))
    .join(" ")
    .toLowerCase()
    .split(/[\s\u00a0]+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
const count = (xml: string, re: RegExp) => (xml.match(re) || []).length;
const resolve = (from: string, target: string) => path.posix.normalize(path.posix.join(path.posix.dirname(from), target)).replace(/^\//, "");

async function measure(data: Uint8Array | ArrayBuffer): Promise<Counts> {
  const zip = await JSZip.loadAsync(data);
  // the fallback of mc:AlternateContent repeats its choice (for older readers): leave it out
  const read = async (p: string) => ((await zip.file(p)?.async("string")) || "").replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "");
  const rel = (xml: string) => [...xml.matchAll(/<Relationship\b[^>]*>/g)].map((m) => ({ target: /Target="([^"]+)"/.exec(m[0])?.[1] || "", type: /Type="([^"]+)"/.exec(m[0])?.[1] || "", external: /TargetMode="External"/.test(m[0]) }));
  const main = rel(await read("_rels/.rels")).find((r) => r.type.endsWith("/officeDocument"));
  const docPath = main ? resolve("", main.target) : "word/document.xml";
  const xml = await read(docPath);
  const rels = rel(await read(docPath.replace(/([^/]+)$/, "_rels/$1.rels")));
  const part = async (suffix: string) => {
    let s = "";
    for (const r of rels) if (r.type.endsWith(suffix) && !r.external) s += await read(resolve(docPath, r.target));
    return s;
  };
  const body = xml.replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g, "");
  // headers and footers the sections use
  const hfIds = new Set([...xml.matchAll(/<w:(?:header|footer)Reference [^>]*r:id="([^"]+)"/g)].map((m) => m[1]));
  let hf = "";
  for (const m of (await read(docPath.replace(/([^/]+)$/, "_rels/$1.rels"))).matchAll(/<Relationship\b[^>]*>/g))
    if (hfIds.has(/Id="([^"]+)"/.exec(m[0])?.[1] || "")) hf += await read(resolve(docPath, /Target="([^"]+)"/.exec(m[0])?.[1] || ""));
  // the separator notes Word adds (ids -1 and 0) are not content
  const notesAll = ((await part("/footnotes")) + (await part("/endnotes"))).replace(/<w:(footnote|endnote)\b[^>]*w:type="(separator|continuationSeparator|continuationNotice)"[\s\S]*?<\/w:\1>/g, "");
  // only comments and notes the text refers to (Word drops the others too)
  const refs = (xml: string, tag: string) => new Set([...xml.matchAll(new RegExp(`<w:${tag} [^>]*w:id="(-?\\d+)"`, "g"))].map((m) => m[1]));
  const usedNotes = { footnote: refs(body + hf, "footnoteReference"), endnote: refs(body + hf, "endnoteReference") };
  const notesXml = notesAll.replace(/<w:(footnote|endnote)\b([^>]*)>[\s\S]*?<\/w:\1>/g, (m, kind: "footnote" | "endnote", a: string) => (usedNotes[kind].has(/w:id="(-?\d+)"/.exec(a)?.[1] || "") ? m : ""));
  const usedComments = refs(body + hf + notesXml, "commentReference");
  const commentsXml = (await part("/comments")).replace(/<w:comment\b([^>]*)>[\s\S]*?<\/w:comment>/g, (m, a: string) => (usedComments.has(/w:id="(-?\d+)"/.exec(a)?.[1] || "") ? m : ""));
  const all = body + hf + notesXml;
  const hyperlinkFields = count(all, /<w:instrText[^>]*>\s*HYPERLINK\b|<w:fldSimple [^>]*w:instr="\s*HYPERLINK\b/g);
  return {
    paras: count(body, /<w:p[ >/]/g),
    tables: count(all, /<w:tbl>/g),
    pics: count(all, /<pic:pic\b|<v:imagedata\b/g),
    charts: count(all, /<c:chart\b/g),
    smartart: count(all, /<dgm:relIds\b/g),
    math: count(all, /<m:oMath>/g),
    lists: count(body, /<w:numPr>/g),
    // fields other than HYPERLINK (those are counted with the links: either form is a link)
    fields: count(all, /<w:fldSimple\b|<w:fldChar [^>]*w:fldCharType="begin"/g) - hyperlinkFields,
    links: count(all, /<w:hyperlink\b/g) + hyperlinkFields,
    // words in tracked insertions and deletions (how the runs are split into revisions can differ)
    changes: (all.match(/<w:(ins|moveTo) [^>]*[^/]>[\s\S]*?<\/w:\1>/g) || []).reduce((n, x) => n + words(x).length, 0) + words(all.split(/<\/w:p>/).map((p) => [...p.matchAll(/<w:delText(?:\s[^>]*)?>([^<]*)<\/w:delText>/g)].map((m) => `<w:t>${m[1]}</w:t>`).join("")).join("</w:p>")).length,
    sdts: count(all, /<w:sdt>/g),
    sections: count(xml, /<w:sectPr\b/g),
    comments: count(commentsXml, /<w:comment\b/g),
    notes: count(notesXml, /<w:(footnote|endnote)\b/g),
    body: words(body),
    hf: words(hf),
    noteWords: words(notesXml),
    commentWords: words(commentsXml),
  };
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

type Flat = Record<Key, number> & { body: number; hf: number; noteWords: number; commentWords: number };
type Row = { file: string; ok: boolean; error?: string; ms: number; src?: Flat; out?: Flat; text?: number; hfRecall?: number; notesRecall?: number; commentsRecall?: number; warnings?: string[]; missing?: string[]; hfMissing?: string[] };

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
      for (const f of readdirSync(p).sort()) if (/\.(docx|docm|dotx|dotm)$/i.test(f)) files.push(path.join(p, f));
    } else files.push(p);
  }
}
if (outDir) mkdirSync(outDir, { recursive: true });

const { importDocx, IMPORTED_THREAD } = await import("../lib/docs/docx-import");
const { buildDocx } = await import("../lib/docs/docx-export");
const rows: Row[] = [];
for (const file of files) {
  const t0 = Date.now();
  const row: Row = { file: path.basename(file), ok: false, ms: 0 };
  try {
    const bytes = readFileSync(file);
    const d = await importDocx(bytes);
    const src = await measure(bytes);
    const back = await buildDocx({
      doc: d.doc,
      styles: d.styles,
      body: d.body,
      settings: d.settings,
      comments: d.comments.map((c) => ({ id: IMPORTED_THREAD + c.key, resolved: c.resolved, messages: c.messages })),
    });
    if (outDir) writeFileSync(path.join(outDir, path.basename(file).replace(/\.\w+$/, ".docx")), Buffer.from(back));
    const out = await measure(back);
    const flat = (c: Counts): Flat => ({ ...c, body: c.body.length, hf: c.hf.length, noteWords: c.noteWords.length, commentWords: c.commentWords.length });
    Object.assign(row, { ok: true, src: flat(src), out: flat(out), text: recall(src.body, out.body), hfRecall: recall(src.hf, out.hf), notesRecall: recall(src.noteWords, out.noteWords), commentsRecall: recall(src.commentWords, out.commentWords), warnings: d.warnings || [] });
    // which source words went missing (a sample), to find what loses them
    const bag = new Map<string, number>();
    for (const w of out.body) bag.set(w, (bag.get(w) || 0) + 1);
    row.missing = src.body.filter((w) => { const n = bag.get(w) || 0; if (n) bag.set(w, n - 1); return !n; }).slice(0, 12);
    const hbag = new Map<string, number>();
    for (const w of out.hf) hbag.set(w, (hbag.get(w) || 0) + 1);
    row.hfMissing = src.hf.filter((w) => { const n = hbag.get(w) || 0; if (n) hbag.set(w, n - 1); return !n; }).slice(0, 12);
  } catch (e) {
    row.error = (e as Error).message.slice(0, 160);
  }
  row.ms = Date.now() - t0;
  rows.push(row);
  const s = row.src, o = row.out;
  const lost = s && o ? KEYS.filter((k) => o[k] < s[k]).map((k) => `${k} ${s[k]}->${o[k]}`) : [];
  console.log(
    row.ok
      ? `${row.file}\ttext ${(row.text! * 100).toFixed(1)}%\thf ${(row.hfRecall! * 100).toFixed(0)}%\tnotes ${(row.notesRecall! * 100).toFixed(0)}%\tcomments ${(row.commentsRecall! * 100).toFixed(0)}%\t${row.ms}ms${lost.length ? `\tfewer: ${lost.join(", ")}` : ""}${row.missing?.length ? `\tmissing: ${row.missing.join(" ")}` : ""}`
      : `${row.file}\tFAILED: ${row.error}`,
  );
}
const ok = rows.filter((r) => r.ok);
const sum = (f: (r: Row) => number) => ok.reduce((a, r) => a + f(r), 0);
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "n/a");
console.log(`\n${rows.length} files, ${ok.length} round-tripped`);
console.log(`body words ${pct(sum((r) => r.text! * r.src!.body), sum((r) => r.src!.body))} of ${sum((r) => r.src!.body)}`);
console.log(`header/footer words ${pct(sum((r) => r.hfRecall! * r.src!.hf), sum((r) => r.src!.hf))} of ${sum((r) => r.src!.hf)}`);
console.log(`note words ${pct(sum((r) => r.notesRecall! * r.src!.noteWords), sum((r) => r.src!.noteWords))} of ${sum((r) => r.src!.noteWords)}`);
console.log(`comment words ${pct(sum((r) => r.commentsRecall! * r.src!.commentWords), sum((r) => r.src!.commentWords))} of ${sum((r) => r.src!.commentWords)}`);
// kept: what survives, capped at the source count (more out than in is not a gain)
for (const k of KEYS) console.log(`${k}\t${sum((r) => Math.min(r.out![k], r.src![k]))} / ${sum((r) => r.src![k])}\t(out ${sum((r) => r.out![k])})`);
// what the importer said it simplified, by how many files
const said = new Map<string, number>();
for (const r of ok) for (const w of new Set(r.warnings || [])) said.set(w, (said.get(w) || 0) + 1);
for (const [w, n] of [...said].sort((a, b) => b[1] - a[1])) console.log(`${n}\t${w}`);
if (json) writeFileSync(json, JSON.stringify(rows, null, 1));
