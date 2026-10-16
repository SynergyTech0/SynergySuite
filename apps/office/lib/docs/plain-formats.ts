// Plain-text and Markdown files, Word templates and macro-enabled documents.
//  - .txt: one paragraph per line; saved with lists as "• " / "1. " and tables tab-separated.
//  - .md: GitHub-flavoured Markdown (headings, emphasis, links, images, lists, task lists,
//    quotes, code, tables) to the editor's JSON and back.
//  - .dotx/.dotm: a .docx package with a template main part; .docm: macros are dropped.
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import JSZip from "jszip";
import type { PMNode } from "./model";

type Mark = { type: string; attrs?: Record<string, unknown> };

// ---------- plain text ----------

/** Text to paragraphs (one per line; a form feed is a page break). */
export function textToDoc(text: string): PMNode {
  const t = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const content: PMNode[] = [];
  for (const line of t.split("\n")) {
    const pages = line.split("\f");
    pages.forEach((piece, i) => {
      if (i > 0) content.push({ type: "pageBreak" });
      if (i === 0 || piece) content.push({ type: "paragraph", ...(piece ? { content: [{ type: "text", text: piece }] } : {}) });
    });
  }
  while (content.length > 1 && content[content.length - 1].type === "paragraph" && !content[content.length - 1].content) content.pop();
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

function inlineText(n: PMNode): string {
  if (n.type === "text") return n.text || "";
  if (n.type === "hardBreak") return "\n";
  if (n.type === "docField" || n.type === "crossRef") return String(n.attrs?.result || "");
  if (n.type === "mergeField") return `«${n.attrs?.name || ""}»`;
  return (n.content || []).map(inlineText).join("");
}

/** The document as plain text (Windows line ends are the caller's choice). */
export function docToText(doc: PMNode): string {
  const out: string[] = [];
  const walk = (n: PMNode, indent: string) => {
    switch (n.type) {
      case "paragraph":
      case "heading":
        out.push(indent + inlineText(n));
        return;
      case "bulletList":
      case "taskList":
      case "orderedList": {
        let i = Number(n.attrs?.start ?? 1);
        for (const item of n.content || []) {
          const mark = n.type === "orderedList" ? `${i++}. ` : n.type === "taskList" ? (item.attrs?.checked ? "☒ " : "☐ ") : "• ";
          (item.content || []).forEach((c, k) => {
            if (k === 0 && (c.type === "paragraph" || c.type === "heading")) out.push(indent + mark + inlineText(c));
            else walk(c, indent + "    ");
          });
        }
        return;
      }
      case "table":
        for (const r of n.content || []) out.push(indent + (r.content || []).map((c) => (c.content || []).map(inlineText).join(" ")).join("\t"));
        return;
      case "codeBlock":
        for (const l of inlineText(n).split("\n")) out.push(indent + l);
        return;
      case "pageBreak":
        out.push("\f");
        return;
      case "horizontalRule":
        out.push("");
        return;
      default:
        for (const c of n.content || []) walk(c, indent);
    }
  };
  walk(doc, "");
  return out.join("\n").replace(/\n\f\n/g, "\n\f");
}

// ---------- Markdown in ----------

type Md = { type: string; children?: Md[]; value?: string; depth?: number; ordered?: boolean; start?: number | null; checked?: boolean | null; url?: string; alt?: string; title?: string | null; lang?: string | null; identifier?: string; align?: (string | null)[] };

/** Markdown (GFM) to the editor's JSON. */
export function markdownToDoc(md: string): PMNode {
  const tree = fromMarkdown(md.replace(/^\uFEFF/, ""), { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }) as unknown as Md;
  const defs = new Map<string, { url: string; title?: string | null }>();
  const collect = (n: Md) => {
    if (n.type === "definition" && n.identifier) defs.set(n.identifier.toLowerCase(), { url: n.url || "", title: n.title });
    n.children?.forEach(collect);
  };
  collect(tree);
  const footnotes: PMNode[] = [];

  const inline = (nodes: Md[] | undefined, marks: Mark[]): PMNode[] => {
    const out: PMNode[] = [];
    const add = (n: PMNode) => out.push(marks.length && n.type === "text" ? { ...n, marks } : n);
    for (const n of nodes || []) {
      switch (n.type) {
        case "text":
          if (n.value) add({ type: "text", text: n.value.replace(/\n/g, " ") });
          break;
        case "inlineCode":
          out.push({ type: "text", text: n.value || " ", marks: [...marks, { type: "code" }] });
          break;
        case "emphasis":
          out.push(...inline(n.children, [...marks, { type: "italic" }]));
          break;
        case "strong":
          out.push(...inline(n.children, [...marks, { type: "bold" }]));
          break;
        case "delete":
          out.push(...inline(n.children, [...marks, { type: "strike" }]));
          break;
        case "link":
          out.push(...inline(n.children, [...marks, { type: "link", attrs: { href: n.url } }]));
          break;
        case "linkReference": {
          const d = defs.get((n.identifier || "").toLowerCase());
          out.push(...inline(n.children, d ? [...marks, { type: "link", attrs: { href: d.url } }] : marks));
          break;
        }
        case "image":
        case "imageReference": {
          const url = n.type === "image" ? n.url : defs.get((n.identifier || "").toLowerCase())?.url;
          if (url) out.push({ type: "image", attrs: { src: url, alt: n.alt || null, title: n.title || null } });
          break;
        }
        case "break":
          out.push({ type: "hardBreak" });
          break;
        case "html":
          if (/^<br\s*\/?>$/i.test(n.value || "")) out.push({ type: "hardBreak" });
          else if (n.value) add({ type: "text", text: n.value });
          break;
        case "footnoteReference":
          add({ type: "text", text: `[^${n.identifier}]` });
          break;
        default:
          if (n.children) out.push(...inline(n.children, marks));
          else if (n.value) add({ type: "text", text: n.value });
      }
    }
    return out;
  };

  // images are block nodes in this editor: split a paragraph around them
  const para = (n: Md, type = "paragraph", attrs?: Record<string, unknown>): PMNode[] => {
    const parts = inline(n.children, []);
    const out: PMNode[] = [];
    let cur: PMNode[] = [];
    const flush = () => {
      if (cur.length) out.push({ type, ...(attrs ? { attrs } : {}), content: cur });
      cur = [];
    };
    for (const p of parts) {
      if (p.type === "image") {
        flush();
        out.push(p);
      } else cur.push(p);
    }
    flush();
    if (!out.length) out.push({ type, ...(attrs ? { attrs } : {}) });
    return out;
  };

  const blocks = (nodes: Md[] | undefined): PMNode[] => {
    const out: PMNode[] = [];
    for (const n of nodes || []) {
      switch (n.type) {
        case "paragraph":
          out.push(...para(n));
          break;
        case "heading":
          out.push(...para(n, "heading", { level: Math.min(6, Math.max(1, n.depth || 1)) }));
          break;
        case "thematicBreak":
          out.push({ type: "horizontalRule" });
          break;
        case "blockquote":
          out.push({ type: "blockquote", content: blocks(n.children).length ? blocks(n.children) : [{ type: "paragraph" }] });
          break;
        case "code":
          out.push({ type: "codeBlock", attrs: { language: n.lang || null }, ...(n.value ? { content: [{ type: "text", text: n.value }] } : {}) });
          break;
        case "list": {
          const items = n.children || [];
          const task = items.some((i) => typeof i.checked === "boolean");
          if (task)
            out.push({ type: "taskList", content: items.map((i) => ({ type: "taskItem", attrs: { checked: !!i.checked }, content: itemContent(i) })) });
          else out.push({ type: n.ordered ? "orderedList" : "bulletList", ...(n.ordered && (n.start ?? 1) !== 1 ? { attrs: { start: n.start } } : {}), content: items.map((i) => ({ type: "listItem", content: itemContent(i) })) });
          break;
        }
        case "table": {
          const rows = n.children || [];
          out.push({
            type: "table",
            content: rows.map((r, ri) => ({
              type: "tableRow",
              content: (r.children || []).map((c, ci) => {
                const al = n.align?.[ci];
                const content = inline(c.children, []).filter((x) => x.type !== "image");
                return { type: ri === 0 ? "tableHeader" : "tableCell", attrs: { colspan: 1, rowspan: 1 }, content: [{ type: "paragraph", ...(al && al !== "left" ? { attrs: { textAlign: al } } : {}), ...(content.length ? { content } : {}) }] };
              }),
            })),
          });
          break;
        }
        case "html":
          if (n.value?.trim()) out.push({ type: "paragraph", content: [{ type: "text", text: n.value }] });
          break;
        case "footnoteDefinition": {
          const body = blocks(n.children);
          const first = body[0];
          footnotes.push({ type: "paragraph", content: [{ type: "text", text: `[^${n.identifier}]: ` }, ...((first?.content as PMNode[]) || [])] });
          break;
        }
        case "definition":
          break;
        default:
          if (n.children) out.push(...blocks(n.children));
      }
    }
    return out;
  };
  const itemContent = (i: Md): PMNode[] => {
    const c = blocks(i.children);
    if (!c.length || c[0].type !== "paragraph") c.unshift({ type: "paragraph" });
    return c;
  };
  const content = [...blocks(tree.children), ...footnotes];
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

// ---------- Markdown out ----------

const escMd = (s: string) => s.replace(/([\\`*_[\]<>#|~])/g, "\\$1").replace(/^(\s*)(\d+)\. /, "$1$2\\. ").replace(/^(\s*)([-+]) /, "$1\\$2 ");

function inlineMd(nodes: PMNode[] | undefined): string {
  let out = "";
  const order = ["link", "bold", "italic", "strike", "code"];
  let open: Mark[] = [];
  const delim = (m: Mark, closing: boolean) => (m.type === "bold" ? "**" : m.type === "italic" ? "*" : m.type === "strike" ? "~~" : m.type === "code" ? "`" : m.type === "link" ? (closing ? `](${String(m.attrs?.href || "").replace(/\)/g, "%29").replace(/ /g, "%20")})` : "[") : "");
  const closeTo = (k: number) => {
    while (open.length > k) out += delim(open.pop()!, true);
  };
  for (const n of nodes || []) {
    if (n.type === "hardBreak") {
      closeTo(0);
      out += "\\\n";
      continue;
    }
    const text = n.type === "text" ? n.text || "" : inlineText(n);
    if (!text) continue;
    const marks = ((n.marks || []) as Mark[]).filter((m) => order.includes(m.type)).sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    // keep the common prefix of open marks
    let k = 0;
    while (k < open.length && k < marks.length && open[k].type === marks[k].type && JSON.stringify(open[k].attrs || {}) === JSON.stringify(marks[k].attrs || {})) k++;
    closeTo(k);
    for (const m of marks.slice(k)) {
      out += delim(m, false);
      open.push(m);
    }
    out += marks.some((m) => m.type === "code") ? text : escMd(text);
  }
  closeTo(0);
  open = [];
  return out;
}

/** The document as GitHub-flavoured Markdown. */
export function docToMarkdown(doc: PMNode): string {
  const blocks: string[] = [];
  const render = (n: PMNode, indent: string): string[] => {
    switch (n.type) {
      case "paragraph":
        return [indent + inlineMd(n.content)];
      case "heading":
        return [`${indent}${"#".repeat(Math.min(6, Number(n.attrs?.level) || 1))} ${inlineMd(n.content)}`];
      case "horizontalRule":
        return [indent + "---"];
      case "pageBreak":
      case "sectionBreak":
        return [];
      case "image":
        return [`${indent}![${String(n.attrs?.alt || "").replace(/[[\]]/g, "")}](${n.attrs?.src || ""})`];
      case "codeBlock": {
        const body = inlineText(n);
        const fence = body.includes("```") ? "~~~" : "```";
        return [`${indent}${fence}${n.attrs?.language || ""}`, ...body.split("\n").map((l) => indent + l), indent + fence];
      }
      case "blockquote":
        return (n.content || []).flatMap((c, i) => [...(i ? [indent + ">"] : []), ...render(c, "").map((l) => `${indent}> ${l}`.trimEnd())]);
      case "bulletList":
      case "orderedList":
      case "taskList": {
        const lines: string[] = [];
        let i = Number(n.attrs?.start ?? 1);
        for (const item of n.content || []) {
          const b = indent === "" && bullet === "*" ? "*" : "-";
          const mark = n.type === "orderedList" ? `${i++}${indent === "" && bullet === "*" ? ")" : "."} ` : n.type === "taskList" ? `${b} [${item.attrs?.checked ? "x" : " "}] ` : `${b} `;
          const pad = " ".repeat(n.type === "orderedList" ? mark.length : 2);
          (item.content || []).forEach((c, k) => {
            const r = render(c, "");
            if (k === 0) lines.push(indent + mark + (r[0] ?? ""), ...r.slice(1).map((l) => indent + pad + l));
            else lines.push(...r.map((l) => (l ? indent + pad + l : l)));
          });
        }
        return lines;
      }
      case "table": {
        const rows = (n.content || []).map((r) => (r.content || []).map((c) => (c.content || []).map((p) => inlineMd(p.content)).join("<br>").replace(/\n/g, " ")));
        if (!rows.length) return [];
        const cols = Math.max(...rows.map((r) => r.length));
        const line = (r: string[]) => `${indent}| ${Array.from({ length: cols }, (_, i) => r[i] ?? "").join(" | ")} |`;
        const aligns = (n.content![0].content || []).map((c) => (c.content?.[0]?.attrs?.textAlign as string) || "");
        const sep = `${indent}| ${Array.from({ length: cols }, (_, i) => (aligns[i] === "center" ? ":---:" : aligns[i] === "right" ? "---:" : "---")).join(" | ")} |`;
        return [line(rows[0]), sep, ...rows.slice(1).map(line)];
      }
      case "tableOfContents":
        return [];
      default:
        return (n.content || []).flatMap((c) => render(c, indent));
    }
  };
  // two lists in a row would merge in Markdown: the second uses the other marker
  let bullet = "-";
  let prev = "";
  for (const n of doc.content || []) {
    const kind = n.type === "orderedList" ? "ol" : n.type === "bulletList" || n.type === "taskList" ? "ul" : "";
    bullet = kind && kind === prev && bullet === "-" ? "*" : "-";
    prev = kind;
    const r = render(n, "");
    if (r.length) blocks.push(r.join("\n"));
  }
  return blocks.join("\n\n") + "\n";
}

// ---------- templates and macro-enabled files ----------

export const MAIN_TYPES = {
  document: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  template: "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml",
  macroDocument: "application/vnd.ms-word.document.macroEnabled.main+xml",
  macroTemplate: "application/vnd.ms-word.template.macroEnabledTemplate.main+xml",
};

/** What kind of Word package this is, from its content types. */
export async function packageKind(bytes: Uint8Array | ArrayBuffer): Promise<"document" | "template" | "macroDocument" | "macroTemplate" | null> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const ct = await zip.file("[Content_Types].xml")?.async("string");
    if (!ct) return null;
    for (const [k, v] of Object.entries(MAIN_TYPES)) if (ct.includes(v)) return k as keyof typeof MAIN_TYPES;
    return null;
  } catch {
    return null;
  }
}

/** A .docx package rewritten as a template (.dotx). */
export async function asTemplate(docx: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(docx);
  const ct = await zip.file("[Content_Types].xml")!.async("string");
  zip.file("[Content_Types].xml", ct.replace(MAIN_TYPES.document, MAIN_TYPES.template));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** A template or macro-enabled package as a plain document: the main part's type
 *  becomes a document's, and the VBA project, its relationships and its content types are removed. */
export async function asPlainDocument(bytes: Uint8Array | ArrayBuffer): Promise<{ bytes: Uint8Array; hadMacros: boolean }> {
  const zip = await JSZip.loadAsync(bytes);
  let ct = (await zip.file("[Content_Types].xml")?.async("string")) || "";
  const hadMacros = Object.keys(zip.files).some((f) => /vbaProject\.bin$|vbaData\.xml$/i.test(f));
  for (const v of [MAIN_TYPES.template, MAIN_TYPES.macroDocument, MAIN_TYPES.macroTemplate]) ct = ct.split(v).join(MAIN_TYPES.document);
  ct = ct.replace(/<Override[^>]*PartName="[^"]*(vbaProject\.bin|vbaData\.xml)"[^>]*\/>/gi, "").replace(/<Default[^>]*Extension="bin"[^>]*ContentType="application\/vnd\.ms-office\.vbaProject"[^>]*\/>/gi, "");
  zip.file("[Content_Types].xml", ct);
  for (const f of Object.keys(zip.files)) if (/vbaProject\.bin$|vbaData\.xml$|vbaProject\.bin\.rels$/i.test(f)) zip.remove(f);
  const relsPath = Object.keys(zip.files).find((f) => /^word\/_rels\/[^/]+\.xml\.rels$/.test(f));
  if (relsPath) {
    const rels = await zip.file(relsPath)!.async("string");
    zip.file(relsPath, rels.replace(/<Relationship[^>]*Type="[^"]*\/vbaProject"[^>]*\/>/g, ""));
  }
  // a template attached to the document from a file path is not carried over
  const settings = zip.file("word/settings.xml");
  if (settings) zip.file("word/settings.xml", (await settings.async("string")).replace(/<w:attachedTemplate [^>]*\/>/, ""));
  return { bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }), hadMacros };
}

/** The kind of file from its name and first bytes. */
export function fileKind(name: string, head: Uint8Array): "docx" | "txt" | "md" | "convert" | "html" {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] || "").toLowerCase();
  const zip = head[0] === 0x50 && head[1] === 0x4b;
  if (["md", "markdown", "mdown"].includes(ext)) return "md";
  if (ext === "txt" || ext === "text" || ext === "csv" || ext === "log") return "txt";
  if (ext === "htm" || ext === "html") return "html";
  if (zip && ["docx", "dotx", "docm", "dotm"].includes(ext)) return "docx";
  if (zip && !new TextDecoder().decode(head.subarray(30, 90)).includes("opendocument")) return "docx";
  return "convert";
}
