import { unzipSync } from "fflate";
import { MAX_SCAN_CHARS } from "@synergy/compliance";

/**
 * Reading Word, Excel and PowerPoint packages (zip files of XML), without I/O so it is unit
 * tested directly: the sensitivity label Office recorded on a file, and its text for data loss
 * prevention checks.
 */

/** Largest Office file opened for its label or text; bigger ones are left as they are. */
export const OFFICE_MAX_BYTES = 25 * 1024 * 1024;
/** Most XML unpacked from one package, so a crafted file can't use up memory. */
const UNPACK_BUDGET = 64 * 1024 * 1024;

export function isOfficeName(name: string): boolean {
  return /\.(docx|xlsx|pptx)$/i.test(name);
}

/** The XML parts that hold what people read: body, headers, notes, cells, slides. */
const TEXT_PARTS =
  /^(word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml|xl\/sharedStrings\.xml|xl\/worksheets\/sheet\d+\.xml|ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml)$/;

/** The parts of a package wanted by `want`, or null when it isn't a zip that can be read. */
function unpack(bytes: Uint8Array, want: (name: string) => boolean): Record<string, Uint8Array> | null {
  let budget = UNPACK_BUDGET;
  try {
    return unzipSync(bytes, {
      filter: (f) => {
        if (!want(f.name) || f.originalSize > budget) return false;
        budget -= f.originalSize;
        return true;
      },
    });
  } catch {
    return null;
  }
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (m, e: string) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
    const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
}

/**
 * The enabled label in docProps/custom.xml, as Microsoft Purview and Synergy apps write it:
 * MSIP_Label_<id>_Enabled = true, with its name in MSIP_Label_<id>_Name.
 */
export function labelFromCustomXml(xml: string): { id: string; name?: string } | null {
  const byId = new Map<string, Record<string, string>>();
  const re = /<(?:\w+:)?property\b[^>]*\bname="MSIP_Label_([0-9a-fA-F-]{36})_(\w+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?property>/g;
  for (let m; (m = re.exec(xml)); ) {
    const id = m[1].toLowerCase();
    if (!byId.has(id)) byId.set(id, {});
    byId.get(id)![m[2]] = decodeXml(m[3].replace(/<[^>]*>/g, "")).trim();
  }
  for (const [id, p] of byId) if (/^true$/i.test(p.Enabled ?? "")) return { id, ...(p.Name ? { name: p.Name } : {}) };
  return null;
}

/** The label an Office file carries, or null when it has none or can't be read. */
export function officeLabel(bytes: Uint8Array): { id: string; name?: string } | null {
  const parts = unpack(bytes, (n) => n === "docProps/custom.xml");
  const xml = parts?.["docProps/custom.xml"];
  return xml ? labelFromCustomXml(new TextDecoder().decode(xml)) : null;
}

/** Plain text from one part: paragraphs, rows and cells on their own lines, runs joined up. */
export function xmlText(xml: string): string {
  return decodeXml(
    xml
      .replace(/<\/(?:w:p|a:p|w:tr|row|si)>|<(?:w:br|a:br|w:cr)\b[^>]*\/>/g, "\n")
      .replace(/<\/(?:w:tc|c)>|<w:tab\b[^>]*\/>/g, "\t")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/[ \t]*\n\s*/g, "\n")
    .trim();
}

/** The text of a .docx, .xlsx or .pptx, up to what a DLP check scans; null when it can't be read. */
export function officeText(bytes: Uint8Array): string | null {
  const parts = unpack(bytes, (n) => TEXT_PARTS.test(n));
  if (!parts) return null;
  const names = Object.keys(parts).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  let out = "";
  for (const n of names) {
    if (out.length >= MAX_SCAN_CHARS) break;
    const t = xmlText(new TextDecoder().decode(parts[n]));
    if (t) out += (out ? "\n" : "") + t;
  }
  return out.slice(0, MAX_SCAN_CHARS);
}
