// Pure helpers for file names, types and sizes. No I/O, so they are unit tested directly.

export class UserError extends Error {
  /** `data` goes out in the JSON response next to `error`. */
  constructor(message: string, public status = 400, public data?: Record<string, unknown>) {
    super(message);
  }
}

/** Characters Windows, macOS and Linux all accept in a file name. */
const BAD_CHARS = /[\u0000-\u001f\\/:*?"<>|]/g;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** A name as typed or uploaded, made safe to store and to download on any OS. */
export function cleanName(raw: string): string {
  const name = String(raw ?? "").normalize("NFC").replace(BAD_CHARS, "-").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  if (!name || name === "." || name === "..") throw new UserError("Enter a name");
  if (name.length > 250) throw new UserError("That name is too long");
  return RESERVED.test(name) ? `${name}_` : name;
}

/** "report.pdf" -> ["report", ".pdf"]; dotfiles and folders keep the whole name as the stem. */
export function splitExt(name: string): [string, string] {
  const i = name.lastIndexOf(".");
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ""];
}

/** The first of "name", "name (1)", "name (2)"... not in `taken` (compared without case). */
export function uniqueName(name: string, taken: Iterable<string>, isFolder = false): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const [stem, ext] = isFolder ? [name, ""] : splitExt(name);
  for (let i = 1; ; i++) {
    const next = `${stem} (${i})${ext}`;
    if (!used.has(next.toLowerCase())) return next;
  }
}

/** "a/b/c.txt" -> ["a", "b", "c.txt"], each part cleaned. Used for folder uploads. */
export function splitPath(path: string): string[] {
  const parts = String(path ?? "").split(/[\\/]+/).filter((p) => p && p !== ".");
  if (parts.some((p) => p === "..")) throw new UserError("Bad path");
  if (!parts.length) throw new UserError("Missing file name");
  if (parts.length > 32) throw new UserError("Folders are nested too deeply");
  return parts.map(cleanName);
}

const TYPES: Record<string, string> = {
  txt: "text/plain", md: "text/markdown", csv: "text/csv", tsv: "text/tab-separated-values", log: "text/plain",
  json: "application/json", xml: "application/xml", yaml: "text/yaml", yml: "text/yaml", html: "text/html", htm: "text/html",
  css: "text/css", js: "text/javascript", mjs: "text/javascript", ts: "text/plain", tsx: "text/plain", jsx: "text/plain",
  py: "text/x-python", rb: "text/plain", go: "text/plain", rs: "text/plain", java: "text/plain", c: "text/plain", h: "text/plain",
  cpp: "text/plain", cs: "text/plain", sh: "text/x-shellscript", sql: "text/plain", ini: "text/plain", toml: "text/plain",
  pdf: "application/pdf", rtf: "application/rtf",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml", heic: "image/heic", tif: "image/tiff", tiff: "image/tiff",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/mp4", ogv: "video/ogg",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac", aac: "audio/aac",
  zip: "application/zip", gz: "application/gzip", tar: "application/x-tar", "7z": "application/x-7z-compressed",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ppt: "application/vnd.ms-powerpoint",
  odt: "application/vnd.oasis.opendocument.text", ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation", dwg: "image/vnd.dwg", dxf: "image/vnd.dxf",
};

/** The type a file is stored and served as, from its extension (what the browser sent is not trusted). */
export function mimeFor(name: string): string {
  const ext = splitExt(name)[1].slice(1).toLowerCase();
  return TYPES[ext] ?? "application/octet-stream";
}

export type PreviewKind = "image" | "pdf" | "video" | "audio" | "text" | "none";

/** How the browser can show a file inside Drive. */
export function previewKind(mime: string): PreviewKind {
  if (mime === "application/pdf") return "pdf";
  if (/^image\/(png|jpeg|gif|webp|avif|bmp|x-icon|svg\+xml)$/.test(mime)) return "image";
  if (/^video\/(mp4|webm|ogg)$/.test(mime)) return "video";
  if (/^audio\//.test(mime) && mime !== "audio/aac") return "audio";
  if (isTextMime(mime)) return "text";
  return "none";
}

export function isTextMime(mime: string): boolean {
  return mime.startsWith("text/") || mime === "application/json" || mime === "application/xml";
}

/**
 * Content-Type a download or preview is served with. Anything that could run script on the
 * Drive origin when opened directly (HTML, SVG, XML, JavaScript) goes out as plain text or an
 * image under a sandbox CSP (see contentHeaders), never as a page.
 */
export function servedType(mime: string): string {
  if (previewKind(mime) === "text") return "text/plain; charset=utf-8";
  return mime;
}

/** Content-Disposition with an ASCII fallback and the real name per RFC 6266 / 5987. */
export function disposition(kind: "inline" | "attachment", name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** Parses one "bytes=a-b" range against a file of `size` bytes; null when absent or unusable. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header ?? "").trim());
  if (!m || (!m[1] && !m[2]) || size === 0) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start <= end && start < size ? { start, end } : null;
}

export type Role = "viewer" | "editor" | "owner";
const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

export function atLeast(role: Role | null | undefined, need: Role): boolean {
  return !!role && RANK[role] >= RANK[need];
}

export function maxRole(...roles: (Role | null | undefined)[]): Role | null {
  let best: Role | null = null;
  for (const r of roles) if (r && (!best || RANK[r] > RANK[best])) best = r;
  return best;
}

export function isRole(v: unknown): v is Role {
  return v === "viewer" || v === "editor" || v === "owner";
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function cleanEmail(v: unknown): string {
  const email = String(v ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) throw new UserError("Enter an email address");
  return email;
}
