// vCard 2.1, 3.0 and 4.0 in (RFC 2426, RFC 6350); 3.0 out, which every address book reads.
import { EMPTY_CONTACT, type Address, type ContactInput, type Labeled } from "./types";

export type ParsedContact = ContactInput & { groups: string[]; photo?: { mime: string; data: Buffer } };

type Prop = { name: string; params: Record<string, string[]>; value: string };

/** Joins folded lines (a line starting with a space or tab continues the one before). */
function unfold(src: string): string[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1] += line.slice(1);
    // vCard 2.1 quoted-printable soft line breaks end in "="
    else if (out.length && /QUOTED-PRINTABLE/i.test(out[out.length - 1]) && out[out.length - 1].endsWith("=")) out[out.length - 1] = out[out.length - 1].slice(0, -1) + line;
    else out.push(line);
  }
  return out.filter((l) => l.trim() !== "");
}

/** Splits on `sep` outside quotes and backslash escapes. */
function splitUnescaped(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      cur += c + s[++i];
    } else if (c === '"') {
      quoted = !quoted;
      cur += c;
    } else if (c === sep && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function unescape(s: string): string {
  return s.replace(/\\([nN,;:\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

function escape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function decodeQP(s: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=" && /^[0-9A-F]{2}$/i.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(s.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes).toString("utf8");
}

function parseLine(line: string): Prop | null {
  // the first unquoted colon ends the name and parameters
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const [rawName, ...rawParams] = splitUnescaped(line.slice(0, colon), ";");
  const name = rawName.replace(/^item\d+\./i, "").toUpperCase();
  const params: Record<string, string[]> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    // vCard 2.1 allows bare parameters: TEL;WORK;VOICE:...
    const key = (eq < 0 ? "TYPE" : p.slice(0, eq)).toUpperCase();
    const vals = (eq < 0 ? p : p.slice(eq + 1)).split(",").map((v) => v.replace(/^"|"$/g, ""));
    (params[key] ||= []).push(...vals);
  }
  let value = line.slice(colon + 1);
  if (params.ENCODING?.some((e) => /quoted-printable/i.test(e))) value = decodeQP(value);
  return { name, params, value };
}

const TYPES = ["home", "work", "mobile", "cell", "fax", "pager", "main", "iphone", "other"];

function labelOf(p: Prop): string {
  const types = (p.params.TYPE ?? []).flatMap((t) => t.toLowerCase().split(","));
  if (types.includes("cell") || types.includes("mobile") || types.includes("iphone")) return "mobile";
  if (types.includes("fax")) return types.includes("home") ? "home fax" : "work fax";
  for (const t of ["work", "home", "main", "pager", "other"]) if (types.includes(t)) return t;
  return "other";
}

function typeParam(label: string, kind: "email" | "tel" | "adr" | "url"): string {
  const l = label.toLowerCase();
  if (kind === "tel") {
    if (l === "mobile") return ";TYPE=CELL";
    if (l === "work fax") return ";TYPE=WORK,FAX";
    if (l === "home fax") return ";TYPE=HOME,FAX";
  }
  if (kind === "email" && !["home", "work", "other"].includes(l)) return ";TYPE=INTERNET";
  return TYPES.includes(l) ? `;TYPE=${l.toUpperCase()}` : "";
}

function photoOf(p: Prop): { mime: string; data: Buffer } | undefined {
  const v = p.value.trim();
  const uri = v.match(/^data:([\w.+-]+\/[\w.+-]+)?(;base64)?,(.*)$/s);
  if (uri) return uri[2] ? { mime: uri[1] || "image/jpeg", data: Buffer.from(uri[3], "base64") } : undefined;
  const enc = (p.params.ENCODING ?? []).map((e) => e.toLowerCase());
  if (!enc.includes("b") && !enc.includes("base64")) return undefined; // a URL: not fetched
  const type = (p.params.TYPE ?? ["jpeg"])[0].toLowerCase();
  const mime = type.includes("/") ? type : `image/${type === "jpg" ? "jpeg" : type}`;
  return { mime, data: Buffer.from(v.replace(/\s+/g, ""), "base64") };
}

function birthday(v: string): string {
  const s = v.trim();
  let m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^--(\d{2})-?(\d{2})$/); // a birthday without a year
  if (m) return `1604-${m[1]}-${m[2]}`;
  return "";
}

/** Reads every contact in a .vcf file. */
export function parseVCards(src: string): ParsedContact[] {
  const out: ParsedContact[] = [];
  let cur: Prop[] | null = null;
  for (const line of unfold(src)) {
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VCARD") {
      cur = [];
      continue;
    }
    if (upper === "END:VCARD") {
      if (cur) out.push(fromProps(cur));
      cur = null;
      continue;
    }
    if (!cur) continue;
    const p = parseLine(line);
    if (p) cur.push(p);
  }
  return out;
}

function fromProps(props: Prop[]): ParsedContact {
  const c: ParsedContact = { ...EMPTY_CONTACT, emails: [], phones: [], addresses: [], websites: [], groups: [] };
  let fn = "";
  for (const p of props) {
    const parts = () => splitUnescaped(p.value, ";").map(unescape);
    switch (p.name) {
      case "N": {
        const [last = "", first = "", middle = ""] = parts();
        c.lastName = last.trim();
        c.firstName = first.trim();
        c.middleName = middle.trim();
        break;
      }
      case "FN":
        fn = unescape(p.value).trim();
        break;
      case "NICKNAME":
        c.nickname = unescape(splitUnescaped(p.value, ",")[0]).trim();
        break;
      case "ORG": {
        const [company = "", department = ""] = parts();
        c.company = company.trim();
        c.department = department.trim();
        break;
      }
      case "TITLE":
        c.jobTitle = unescape(p.value).trim();
        break;
      case "EMAIL":
        if (p.value.trim()) c.emails.push({ label: labelOf(p), value: unescape(p.value).trim().replace(/^mailto:/i, "") });
        break;
      case "TEL":
        if (p.value.trim()) c.phones.push({ label: labelOf(p), value: unescape(p.value).trim().replace(/^tel:/i, "") });
        break;
      case "ADR": {
        const [, , street = "", city = "", region = "", postcode = "", country = ""] = parts();
        const a: Address = { label: labelOf(p), street: street.trim(), city: city.trim(), region: region.trim(), postcode: postcode.trim(), country: country.trim() };
        if (a.street || a.city || a.region || a.postcode || a.country) c.addresses.push(a);
        break;
      }
      case "URL":
        if (p.value.trim()) c.websites.push({ label: labelOf(p), value: unescape(p.value).trim() });
        break;
      case "BDAY":
        c.birthday = birthday(p.value);
        break;
      case "NOTE":
        c.notes = unescape(p.value);
        break;
      case "CATEGORIES":
        c.groups.push(...splitUnescaped(p.value, ",").map(unescape).map((s) => s.trim()).filter(Boolean));
        break;
      case "PHOTO": {
        const photo = photoOf(p);
        if (photo && photo.data.length) c.photo = photo;
        break;
      }
    }
  }
  // A card with only FN: split it into first and last name.
  if (!c.firstName && !c.lastName && fn && fn !== c.company) {
    const words = fn.split(/\s+/);
    c.firstName = words.length > 1 ? words.slice(0, -1).join(" ") : fn;
    c.lastName = words.length > 1 ? words[words.length - 1] : "";
  }
  return c;
}

/** Folds a line at 75 octets, as RFC 2426 asks. */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let chunk = "";
  let size = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (size + n > (out.length ? 74 : 75)) {
      out.push(chunk);
      chunk = "";
      size = 0;
    }
    chunk += ch;
    size += n;
  }
  out.push(chunk);
  return out.join("\r\n ");
}

export type CardOut = ContactInput & { displayName: string; groups: string[]; photo?: { mime: string; data: Buffer } | null; uid?: string; modifiedAt?: string };

export function toVCard(c: CardOut): string {
  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  if (c.uid) lines.push(`UID:${c.uid}`);
  lines.push(`FN:${escape(c.displayName)}`);
  lines.push(`N:${[c.lastName, c.firstName, c.middleName, "", ""].map(escape).join(";")}`);
  if (c.nickname) lines.push(`NICKNAME:${escape(c.nickname)}`);
  if (c.company || c.department) lines.push(`ORG:${escape(c.company)}${c.department ? `;${escape(c.department)}` : ""}`);
  if (c.jobTitle) lines.push(`TITLE:${escape(c.jobTitle)}`);
  for (const e of c.emails) lines.push(`EMAIL${typeParam(e.label, "email")}:${escape(e.value)}`);
  for (const p of c.phones) lines.push(`TEL${typeParam(p.label, "tel")}:${escape(p.value)}`);
  for (const a of c.addresses) {
    lines.push(`ADR${typeParam(a.label, "adr")}:${["", "", a.street, a.city, a.region, a.postcode, a.country].map(escape).join(";")}`);
  }
  for (const w of c.websites) lines.push(`URL${typeParam(w.label, "url")}:${w.value.replace(/\n/g, "")}`);
  if (c.birthday) lines.push(c.birthday.startsWith("1604-") ? `BDAY:--${c.birthday.slice(5, 7)}${c.birthday.slice(8)}` : `BDAY:${c.birthday}`);
  if (c.notes) lines.push(`NOTE:${escape(c.notes)}`);
  if (c.groups.length) lines.push(`CATEGORIES:${c.groups.map(escape).join(",")}`);
  if (c.photo) lines.push(`PHOTO;ENCODING=b;TYPE=${c.photo.mime.split("/")[1]?.toUpperCase() || "JPEG"}:${c.photo.data.toString("base64")}`);
  if (c.modifiedAt) lines.push(`REV:${new Date(c.modifiedAt).toISOString().replace(/[-:]|\.\d+/g, "")}`);
  lines.push("END:VCARD");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export type { Labeled };
