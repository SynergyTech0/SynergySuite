/**
 * Apple property lists in their XML form, which is what MDM speaks: commands go to devices as
 * plists, check-ins and command results come back as plists, and configuration profiles are plists.
 * Only the XML format is handled (binary plists never reach an MDM server).
 */

export type PlistValue = string | number | boolean | Date | Buffer | PlistValue[] | { [key: string]: PlistValue };

/** A whole-number value, written as <integer> even when it is 0 or round. Numbers otherwise pick integer or real. */
export class PlistInteger {
  constructor(readonly value: number) {}
}
/** A value written as <real>. */
export class PlistReal {
  constructor(readonly value: number) {}
}
type In = PlistValue | PlistInteger | PlistReal | undefined | null | In[] | { [key: string]: In };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function write(v: In, indent: string): string {
  const next = `${indent}\t`;
  if (v instanceof PlistInteger) return `${indent}<integer>${Math.trunc(v.value)}</integer>`;
  if (v instanceof PlistReal) return `${indent}<real>${v.value}</real>`;
  if (typeof v === "string") return `${indent}<string>${esc(v)}</string>`;
  if (typeof v === "boolean") return `${indent}<${v}/>`;
  if (typeof v === "number") return Number.isInteger(v) ? `${indent}<integer>${v}</integer>` : `${indent}<real>${v}</real>`;
  if (v instanceof Date) return `${indent}<date>${v.toISOString().replace(/\.\d{3}Z$/, "Z")}</date>`;
  if (Buffer.isBuffer(v)) return `${indent}<data>${v.toString("base64")}</data>`;
  if (Array.isArray(v)) {
    const items = v.filter((x) => x !== undefined && x !== null);
    return items.length ? `${indent}<array>\n${items.map((x) => write(x, next)).join("\n")}\n${indent}</array>` : `${indent}<array/>`;
  }
  if (v && typeof v === "object") {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined && x !== null);
    if (!entries.length) return `${indent}<dict/>`;
    return `${indent}<dict>\n${entries.map(([k, x]) => `${next}<key>${esc(k)}</key>\n${write(x, next)}`).join("\n")}\n${indent}</dict>`;
  }
  throw new Error("Unsupported plist value");
}

/** Serializes a value as an XML plist document. undefined and null dictionary values are left out. */
export function buildPlist(v: In): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${write(v, "")}\n</plist>\n`;
}

export class PlistError extends Error {}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function unesc(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

type Tok = { kind: "open" | "close" | "empty"; name: string } | { kind: "text"; text: string };

function tokens(xml: string): Tok[] {
  const out: Tok[] = [];
  // Comments, the XML declaration, the doctype and CDATA-free text are all that plists contain.
  const src = xml.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!DOCTYPE[\s\S]*?>/i, "");
  const re = /<(\/?)([A-Za-z]+)[^>]*?(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[4] !== undefined) {
      out.push({ kind: "text", text: m[4] });
      continue;
    }
    out.push({ kind: m[1] ? "close" : m[3] ? "empty" : "open", name: m[2] });
  }
  return out;
}

/** Parses an XML plist. Integers come back as numbers, data as Buffers and dates as Dates. */
export function parsePlist(xml: string | Buffer): PlistValue {
  const toks = tokens(typeof xml === "string" ? xml : xml.toString("utf8"));
  let i = 0;
  // Whitespace between elements is layout; whitespace inside <string> is kept (textUntil reads it).
  const skipWs = () => {
    while (i < toks.length) {
      const t = toks[i];
      if (t.kind === "text" && t.text.trim() === "") i++;
      else break;
    }
  };
  const peek = () => {
    skipWs();
    return toks[i];
  };
  const textUntil = (name: string): string => {
    let s = "";
    while (i < toks.length) {
      const t = toks[i++];
      if (t.kind === "text") s += t.text;
      else if (t.kind === "close" && t.name === name) return unesc(s);
      else throw new PlistError(`Unexpected <${t.name}> inside <${name}>`);
    }
    throw new PlistError(`Unclosed <${name}>`);
  };
  const value = (): PlistValue => {
    skipWs();
    const t = toks[i++];
    if (!t || t.kind === "text" || t.kind === "close") throw new PlistError("Expected a value");
    if (t.kind === "empty") {
      if (t.name === "true") return true;
      if (t.name === "false") return false;
      if (t.name === "string") return "";
      if (t.name === "array") return [];
      if (t.name === "dict") return {};
      if (t.name === "data") return Buffer.alloc(0);
      throw new PlistError(`Unknown <${t.name}/>`);
    }
    switch (t.name) {
      case "string":
        return textUntil("string");
      case "integer": {
        const n = Number(textUntil("integer").trim());
        if (!Number.isFinite(n)) throw new PlistError("Bad integer");
        return n;
      }
      case "real": {
        const n = Number(textUntil("real").trim());
        if (!Number.isFinite(n)) throw new PlistError("Bad real");
        return n;
      }
      case "date": {
        const d = new Date(textUntil("date").trim());
        if (Number.isNaN(d.getTime())) throw new PlistError("Bad date");
        return d;
      }
      case "data":
        return Buffer.from(textUntil("data").replace(/\s+/g, ""), "base64");
      case "true":
      case "false": {
        const v = t.name === "true";
        skipWs();
        const c = toks[i++];
        if (!c || c.kind !== "close" || c.name !== t.name) throw new PlistError(`Bad <${t.name}>`);
        return v;
      }
      case "array": {
        const arr: PlistValue[] = [];
        for (;;) {
          const n = peek();
          if (!n) throw new PlistError("Unclosed <array>");
          if (n.kind === "close" && n.name === "array") {
            i++;
            return arr;
          }
          arr.push(value());
        }
      }
      case "dict": {
        const obj: Record<string, PlistValue> = {};
        for (;;) {
          skipWs();
          const n = toks[i++];
          if (!n) throw new PlistError("Unclosed <dict>");
          if (n.kind === "close" && n.name === "dict") return obj;
          if (n.kind === "empty" && n.name === "key") {
            obj[""] = value();
            continue;
          }
          if (n.kind !== "open" || n.name !== "key") throw new PlistError("Expected <key> in <dict>");
          const k = textUntil("key");
          obj[k] = value();
        }
      }
      default:
        throw new PlistError(`Unknown <${t.name}>`);
    }
  };
  skipWs();
  const first = toks[i++];
  if (!first || first.kind !== "open" || first.name !== "plist") throw new PlistError("Not a plist");
  const v = value();
  return v;
}

/** A plist dictionary, or {} when the value isn't one. */
export function dict(v: unknown): Record<string, PlistValue> {
  return v && typeof v === "object" && !Array.isArray(v) && !Buffer.isBuffer(v) && !(v instanceof Date) ? (v as Record<string, PlistValue>) : {};
}
export const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
export const boolOrNull = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
