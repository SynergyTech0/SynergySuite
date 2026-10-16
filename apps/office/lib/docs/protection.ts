// Restrict editing: Word's document protection (read only with editable
// exceptions, comments only, tracked changes only, filling in forms), the
// content controls people fill in, and their WordprocessingML.
import { checkWordPassword, hasWordPassword, canCheckWordPassword, wordPasswordAttrs } from "./word-password";

export type ProtectionMode = "readOnly" | "comments" | "trackedChanges" | "forms";
export type Protection = {
  edit: ProtectionMode;
  enforced: boolean;
  /** our older password check: SHA-256 of salt + password (hex); new passwords use Word's hash in `word` */
  hash?: string;
  salt?: string;
  /** the w:documentProtection attributes of a Word file (its password hash), written back unchanged */
  word?: Record<string, string>;
};
export const PROTECTION_LABELS: Record<ProtectionMode, string> = {
  readOnly: "No changes (read only)",
  comments: "Comments",
  trackedChanges: "Tracked changes",
  forms: "Filling in forms",
};

export type ControlKind = "text" | "richText" | "checkbox" | "dropdown" | "comboBox" | "date";
export type ControlItem = { text: string; value: string };
export const CONTROL_LABELS: Record<ControlKind, string> = {
  richText: "Rich text content control",
  text: "Plain text content control",
  checkbox: "Check box content control",
  dropdown: "Drop-down list content control",
  comboBox: "Combo box content control",
  date: "Date picker content control",
};
export const CHECKED = "☒";
export const UNCHECKED = "☐";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function parseItems(v: unknown): ControlItem[] {
  if (Array.isArray(v)) return v as ControlItem[];
  if (typeof v !== "string" || !v) return [];
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) ? a.filter((x) => x && typeof x.text === "string").map((x) => ({ text: x.text, value: typeof x.value === "string" ? x.value : x.text })) : [];
  } catch {
    return [];
  }
}

export type ControlAttrs = { kind: ControlKind; tag?: string | null; title?: string | null; items?: string | null; checked?: boolean; dateFormat?: string | null; date?: string | null; lockContents?: boolean; lockControl?: boolean; placeholder?: string | null };

/** w:sdtPr for an inline content control. `id` is unique in the document; `empty` shows the placeholder. */
export function sdtPrXml(a: ControlAttrs, id: number, empty: boolean): string {
  const x: string[] = [];
  if (a.title) x.push(`<w:alias w:val="${esc(a.title)}"/>`);
  if (a.tag) x.push(`<w:tag w:val="${esc(a.tag)}"/>`);
  x.push(`<w:id w:val="${id}"/>`);
  if (a.lockContents || a.lockControl) x.push(`<w:lock w:val="${a.lockContents && a.lockControl ? "sdtContentLocked" : a.lockContents ? "contentLocked" : "sdtLocked"}"/>`);
  if (empty && a.kind !== "checkbox") x.push("<w:showingPlcHdr/>");
  switch (a.kind) {
    case "text":
      x.push("<w:text/>");
      break;
    case "dropdown":
    case "comboBox": {
      const tag = a.kind === "dropdown" ? "w:dropDownList" : "w:comboBox";
      x.push(`<${tag}>${parseItems(a.items).map((i) => `<w:listItem w:displayText="${esc(i.text)}" w:value="${esc(i.value)}"/>`).join("")}</${tag}>`);
      break;
    }
    case "date":
      x.push(`<w:date${a.date ? ` w:fullDate="${esc(a.date)}T00:00:00Z"` : ""}><w:dateFormat w:val="${esc(a.dateFormat || "M/d/yyyy")}"/><w:lid w:val="en-US"/><w:storeMappedDataAs w:val="dateTime"/><w:calendar w:val="gregorian"/></w:date>`);
      break;
    case "checkbox":
      x.push(`<w14:checkbox><w14:checked w14:val="${a.checked ? 1 : 0}"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox>`);
      break;
    case "richText":
      break;
  }
  return `<w:sdtPr>${x.join("")}</w:sdtPr>`;
}

type El = { local: string; attrs: Record<string, string>; children: El[] };
const kid = (e: El | undefined, n: string) => e?.children.find((c) => c.local === n);
const val = (e: El | undefined, k = "val") => (e ? e.attrs[k] ?? e.attrs[`w:${k}`] ?? e.attrs[`w14:${k}`] : undefined);

/** A content control's attributes from w:sdtPr, or null for structured tags that are not form controls (citations, building blocks, equations). */
export function readSdtPr(pr: El | undefined): (ControlAttrs & { showingPlaceholder: boolean }) | null {
  if (!pr) return null;
  if (pr.children.some((c) => ["citation", "bibliography", "docPartObj", "docPartList", "equation", "group", "picture"].includes(c.local))) return null;
  let kind: ControlKind = "richText";
  const out: ControlAttrs & { showingPlaceholder: boolean } = { kind, showingPlaceholder: !!kid(pr, "showingPlcHdr") };
  if (kid(pr, "text")) kind = "text";
  const list = kid(pr, "dropDownList") || kid(pr, "comboBox");
  if (list) {
    kind = list.local === "dropDownList" ? "dropdown" : "comboBox";
    out.items = JSON.stringify(list.children.filter((c) => c.local === "listItem").map((c) => ({ text: val(c, "displayText") ?? val(c, "value") ?? "", value: val(c, "value") ?? val(c, "displayText") ?? "" })));
  }
  const date = kid(pr, "date");
  if (date) {
    kind = "date";
    out.dateFormat = val(kid(date, "dateFormat")) || "M/d/yyyy";
    const full = val(date, "fullDate");
    if (full) out.date = full.slice(0, 10);
  }
  const cb = kid(pr, "checkbox");
  if (cb) {
    kind = "checkbox";
    const c = val(kid(cb, "checked"));
    out.checked = c === "1" || c === "true";
  }
  out.kind = kind;
  const alias = val(kid(pr, "alias"));
  if (alias) out.title = alias;
  const tag = val(kid(pr, "tag"));
  if (tag) out.tag = tag;
  const lock = val(kid(pr, "lock"));
  if (lock === "contentLocked" || lock === "sdtContentLocked") out.lockContents = true;
  if (lock === "sdtLocked" || lock === "sdtContentLocked") out.lockControl = true;
  return out;
}

/**
 * A block-level content control (paragraphs, tables and lists inside w:sdt
 * in the body): a rich text control, a group, or a building-block gallery
 * (cover page, quick parts…).
 */
export type BlockControlAttrs = { kind: "richText" | "group" | "docPart"; title?: string | null; tag?: string | null; lockContents?: boolean; lockControl?: boolean; gallery?: string | null; category?: string | null };

/** A block control's attributes from w:sdtPr. */
export function readBlockSdtPr(pr: El | undefined): BlockControlAttrs {
  const out: BlockControlAttrs = { kind: "richText" };
  if (!pr) return out;
  if (kid(pr, "group")) out.kind = "group";
  const part = kid(pr, "docPartObj") || kid(pr, "docPartList");
  if (part) {
    out.kind = "docPart";
    const g = val(kid(part, "docPartGallery"));
    const c = val(kid(part, "docPartCategory"));
    if (g) out.gallery = g;
    if (c) out.category = c;
  }
  const alias = val(kid(pr, "alias"));
  if (alias) out.title = alias;
  const tag = val(kid(pr, "tag"));
  if (tag) out.tag = tag;
  const lock = val(kid(pr, "lock"));
  if (lock === "contentLocked" || lock === "sdtContentLocked") out.lockContents = true;
  if (lock === "sdtLocked" || lock === "sdtContentLocked") out.lockControl = true;
  return out;
}

/** w:sdtPr for a block control. */
export function blockSdtPrXml(a: Partial<BlockControlAttrs>, id: number): string {
  const x: string[] = [];
  if (a.title) x.push(`<w:alias w:val="${esc(a.title)}"/>`);
  if (a.tag) x.push(`<w:tag w:val="${esc(a.tag)}"/>`);
  x.push(`<w:id w:val="${id}"/>`);
  if (a.lockContents || a.lockControl) x.push(`<w:lock w:val="${a.lockContents && a.lockControl ? "sdtContentLocked" : a.lockContents ? "contentLocked" : "sdtLocked"}"/>`);
  if (a.kind === "group") x.push("<w:group/>");
  if (a.kind === "docPart") x.push(`<w:docPartObj>${a.gallery ? `<w:docPartGallery w:val="${esc(a.gallery)}"/>` : ""}${a.category ? `<w:docPartCategory w:val="${esc(a.category)}"/>` : ""}<w:docPartUnique/></w:docPartObj>`);
  return `<w:sdtPr>${x.join("")}</w:sdtPr>`;
}

/** w:documentProtection (goes in settings.xml after trackRevisions). */
export function protectionXml(p: Protection | undefined): string {
  if (!p) return "";
  const word = p.word || {};
  const extra = Object.entries(word)
    .filter(([k]) => !/^(w:)?(edit|enforcement)$/.test(k))
    .map(([k, v]) => ` ${k.includes(":") ? k : `w:${k}`}="${esc(v)}"`)
    .join("");
  return `<w:documentProtection w:edit="${p.edit}" w:enforcement="${p.enforced ? 1 : 0}"${extra}/>`;
}

export function readProtection(el: El | undefined): Protection | undefined {
  if (!el) return undefined;
  const edit = val(el, "edit");
  if (edit !== "readOnly" && edit !== "comments" && edit !== "trackedChanges" && edit !== "forms") return undefined;
  const enf = val(el, "enforcement");
  const word: Record<string, string> = {};
  for (const [k, v] of Object.entries(el.attrs)) if (!/^(w:)?(edit|enforcement)$/.test(k) && /hash|salt|spin|crypt|algorithm/i.test(k)) word[k.includes(":") ? k : `w:${k}`] = v;
  return { edit, enforced: enf === "1" || enf === "true" || enf === "on", ...(Object.keys(word).length ? { word } : {}) };
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** A new password, hashed the way Word does it, so Word asks for the same password. */
export async function hashPassword(password: string): Promise<{ word: Record<string, string> }> {
  return { word: await wordPasswordAttrs(password) };
}
/** Whether a password lifts the protection: our older hash, or Word's (from Word or from us). */
export async function checkPassword(p: Protection, password: string): Promise<boolean> {
  if (p.hash && p.salt) return (await sha256Hex(p.salt + password)) === p.hash;
  const word = await checkWordPassword(p.word, password);
  return word ?? true;
}
/** Whether stopping the protection asks for a password. */
export function needsPassword(p: Protection | undefined): boolean {
  return !!p && (!!(p.hash && p.salt) || hasWordPassword(p.word));
}
/** A Word password hash in an algorithm we can't compute (it can't be checked, so it isn't asked for). */
export function uncheckablePassword(p: Protection | undefined): boolean {
  return !!p && !p.hash && hasWordPassword(p.word) && !canCheckWordPassword(p.word);
}
