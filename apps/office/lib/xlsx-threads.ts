// Comment threads in .xlsx as Excel's threaded comments (Excel 365): one
// threadedComments part per sheet, a person list for the authors, and a plain
// legacy comment on the same cell so older Excel versions and other programs
// still show the text. Excel ties the two together through the legacy
// comment's author, "tc={thread id}".
import * as XLSX from "xlsx";
import { openPackage, xmlDecode, xmlEscape } from "./xlsx-ooxml.ts";

export type ThreadMessage = { author_name: string; author_email: string; body: string; created_ms: number };
export type SheetThread = { id?: string; sheetId: string; ref: string; resolved: boolean; messages: ThreadMessage[] };

const NS = "http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments";
const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_PERSON = "http://schemas.microsoft.com/office/2017/10/relationships/person";
const REL_THREADED = "http://schemas.microsoft.com/office/2017/10/relationships/threadedComment";
const CT_PERSON = "application/vnd.ms-excel.person+xml";
const CT_THREADED = "application/vnd.ms-excel.threadedcomments+xml";

/** A stable GUID in Excel's {8-4-4-4-12} form, derived from a seed string. */
export function guidFrom(seed: string): string {
  let hex = "";
  for (let round = 0; hex.length < 32; round++) {
    let h = 0x811c9dc5 ^ round;
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
    hex += h.toString(16).padStart(8, "0");
  }
  hex = hex.slice(0, 32).toUpperCase();
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}}`;
}

/** What Excel itself writes into the legacy comment of a threaded comment. */
export function fallbackText(t: SheetThread): string {
  const [first, ...replies] = t.messages;
  return [
    "[Threaded comment]",
    "",
    "Your version of Excel allows you to read this threaded comment; however, any edits to it will get removed if the file is opened in a newer version of Excel. Learn more: https://go.microsoft.com/fwlink/?linkid=870924",
    "",
    "Comment:",
    `    ${first?.body ?? ""}`,
    ...replies.flatMap((m) => ["Reply:", `    ${m.body}`]),
  ].join("\n");
}

const isoTime = (ms: number) => new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString().replace(/Z$/, "").replace(/(\.\d{2})\d$/, "$1");
const personKey = (m: ThreadMessage) => (m.author_email || m.author_name || "Unknown").toLowerCase();

const relsPath = (part: string) => part.replace(/([^/]+)$/, "_rels/$1.rels");
const relTarget = (from: string, to: string) => {
  const a = from.split("/").slice(0, -1);
  const b = to.split("/");
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
};
const resolvePath = (base: string, target: string) => {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
};

function addRel(relsXml: string, type: string, target: string): { xml: string; id: string } {
  const xml = relsXml || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  const used = new Set([...xml.matchAll(/\bId="([^"]+)"/g)].map((m) => m[1]));
  let n = used.size + 1;
  while (used.has(`rId${n}`)) n++;
  const id = `rId${n}`;
  return { xml: xml.replace("</Relationships>", `<Relationship Id="${id}" Type="${type}" Target="${xmlEscape(target)}"/></Relationships>`), id };
}

const addOverride = (ct: string, part: string, type: string) =>
  ct.includes(`PartName="/${part}"`) ? ct : ct.replace("</Types>", `<Override PartName="/${part}" ContentType="${type}"/></Types>`);

/**
 * Adds threaded comments to a package ExcelJS wrote. Each thread's cell must
 * already carry its legacy comment (fallbackText); its author is re-pointed
 * at the thread here.
 */
export async function addThreadedComments(bytes: Uint8Array, bySheet: Map<number, SheetThread[]>): Promise<Uint8Array> {
  const threads = [...bySheet.values()].flat().filter((t) => t.messages.length);
  if (!threads.length) return bytes;
  const pkg = await openPackage(bytes);
  const persons = new Map<string, { id: string; name: string; email: string }>();
  for (const t of threads)
    for (const m of t.messages) {
      const key = personKey(m);
      if (!persons.has(key)) persons.set(key, { id: guidFrom(`person:${key}`), name: m.author_name || m.author_email || "Unknown", email: m.author_email });
    }

  let ct = await pkg.read("[Content_Types].xml");
  let n = 0;
  for (const [index, list] of bySheet) {
    const part = pkg.sheets.find((s) => s.index === index);
    const live = list.filter((t) => t.messages.length);
    if (!part || !live.length) continue;
    const path = `xl/threadedComments/threadedComment${++n}.xml`;
    const items: string[] = [];
    const tcAuthors = new Map<string, string>(); // ref -> tc={root id}
    for (const t of live) {
      const rootId = guidFrom(`thread:${t.id || `${t.sheetId}!${t.ref}`}:${t.messages[0].created_ms}`);
      tcAuthors.set(t.ref, `tc=${rootId}`);
      t.messages.forEach((m, i) => {
        const id = i ? guidFrom(`reply:${rootId}:${i}:${m.created_ms}`) : rootId;
        const attrs = [`ref="${t.ref}"`, `dT="${isoTime(m.created_ms)}"`, `personId="${persons.get(personKey(m))!.id}"`, `id="${id}"`];
        if (i) attrs.push(`parentId="${rootId}"`);
        else if (t.resolved) attrs.push('done="1"');
        items.push(`<threadedComment ${attrs.join(" ")}><text>${xmlEscape(m.body)}</text></threadedComment>`);
      });
    }
    pkg.zip.file(path, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<ThreadedComments xmlns="${NS}" xmlns:x="${MAIN}">${items.join("")}</ThreadedComments>`);
    ct = addOverride(ct, path, CT_THREADED);
    const sheetRels = relsPath(part.path);
    const relsXml = await pkg.read(sheetRels);
    pkg.zip.file(sheetRels, addRel(relsXml, REL_THREADED, relTarget(part.path, path)).xml);

    // Point each thread's legacy comment at the thread.
    const legacy = [...relsXml.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => /relationships\/comments"/.test(r));
    const target = legacy && /Target="([^"]+)"/.exec(legacy)?.[1];
    if (target) {
      const commentsPath = resolvePath(part.path, target);
      let xml = await pkg.read(commentsPath);
      const authors = [...(/<authors>([\s\S]*?)<\/authors>/.exec(xml)?.[1] || "").matchAll(/<author>([\s\S]*?)<\/author>/g)].map((m) => xmlDecode(m[1]));
      const refs = [...tcAuthors.entries()];
      for (const [, a] of refs) if (!authors.includes(a)) authors.push(a);
      xml = xml.replace(/<authors>[\s\S]*?<\/authors>|<authors\/>/, `<authors>${authors.map((a) => `<author>${xmlEscape(a)}</author>`).join("")}</authors>`);
      xml = xml.replace(/<comment\b([^>]*)>/g, (tag, inner: string) => {
        const ref = /\bref="([^"]+)"/.exec(inner)?.[1];
        const a = ref && tcAuthors.get(ref);
        return a ? tag.replace(/\bauthorId="\d+"/, `authorId="${authors.indexOf(a)}"`) : tag;
      });
      pkg.zip.file(commentsPath, xml);
    }
  }

  const personPath = "xl/persons/person.xml";
  pkg.zip.file(
    personPath,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<personList xmlns="${NS}" xmlns:x="${MAIN}">${[...persons.values()]
      .map((p) => `<person displayName="${xmlEscape(p.name)}" id="${p.id}"${p.email ? ` userId="${xmlEscape(p.email)}" providerId="None"` : ""}/>`)
      .join("")}</personList>`,
  );
  ct = addOverride(ct, personPath, CT_PERSON);
  const wbRels = await pkg.read("xl/_rels/workbook.xml.rels");
  if (!wbRels.includes(REL_PERSON)) pkg.zip.file("xl/_rels/workbook.xml.rels", addRel(wbRels, REL_PERSON, "persons/person.xml").xml);
  pkg.zip.file("[Content_Types].xml", ct);
  return (await pkg.zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })) as Uint8Array;
}

/** Threaded comments in a file, by sheet index, oldest message first. */
export async function readThreadedComments(bytes: Uint8Array): Promise<Map<number, Omit<SheetThread, "sheetId">[]>> {
  const out = new Map<number, Omit<SheetThread, "sheetId">[]>();
  const pkg = await openPackage(bytes);
  const wbRels = await pkg.read("xl/_rels/workbook.xml.rels");
  const personTarget = [...wbRels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(REL_PERSON));
  const people = new Map<string, { name: string; email: string }>();
  if (personTarget) {
    const xml = await pkg.read(resolvePath("xl/workbook.xml", /Target="([^"]+)"/.exec(personTarget)![1]));
    for (const m of xml.matchAll(/<person\b[^>]*>/g)) {
      const a = (k: string) => xmlDecode(new RegExp(`\\b${k}="([^"]*)"`).exec(m[0])?.[1] || "");
      const userId = a("userId");
      people.set(a("id"), { name: a("displayName") || userId || "Unknown", email: /@/.test(userId) ? userId.toLowerCase() : "" });
    }
  }
  for (const sheet of pkg.sheets) {
    const relsXml = await pkg.read(relsPath(sheet.path));
    for (const r of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
      if (!r[0].includes(REL_THREADED)) continue;
      const xml = await pkg.read(resolvePath(sheet.path, /Target="([^"]+)"/.exec(r[0])![1]));
      const roots = new Map<string, Omit<SheetThread, "sheetId">>();
      for (const m of xml.matchAll(/<threadedComment\b([^>]*)>([\s\S]*?)<\/threadedComment>/g)) {
        const a = (k: string) => new RegExp(`\\b${k}="([^"]*)"`).exec(m[1])?.[1] || "";
        const body = xmlDecode(/<text>([\s\S]*?)<\/text>/.exec(m[2])?.[1] || "");
        const who = people.get(a("personId")) || { name: "Unknown", email: "" };
        const created = Date.parse(a("dT") ? `${a("dT")}Z` : "");
        const msg: ThreadMessage = { author_name: who.name, author_email: who.email, body, created_ms: Number.isFinite(created) ? created : Date.now() };
        const parent = a("parentId");
        if (parent && roots.has(parent)) roots.get(parent)!.messages.push(msg);
        else roots.set(a("id"), { id: a("id"), ref: a("ref").toUpperCase(), resolved: a("done") === "1", messages: [msg] });
      }
      const list = [...roots.values()].filter((t) => /^[A-Z]+\d+$/.test(t.ref));
      for (const t of list) t.messages.sort((x, y) => x.created_ms - y.created_ms);
      if (list.length) out.set(sheet.index, [...(out.get(sheet.index) || []), ...list]);
    }
  }
  return out;
}

export const refCell = (ref: string) => XLSX.utils.decode_cell(ref);
