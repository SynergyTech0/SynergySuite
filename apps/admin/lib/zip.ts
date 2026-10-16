import { createHash } from "node:crypto";
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from "fflate";
import type { ExportItem } from "@synergy/compliance";

/**
 * Writes an export as a zip, streaming: one folder per app, one JSON file per item, each
 * attachment as its own file beside it, then manifest.csv (a row per item) and summary.json
 * (what was searched, by whom, when, counts, and the SHA-256 of every file in the zip).
 */

export type ZipFile = { path: string; size: number; sha256: string };
export type AppCount = { items: number; attachments: number; skippedAttachments: number; missing: number; truncated?: boolean; error?: string };

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/** A file or folder name that is safe on every system. */
export function safeName(s: string, max = 80): string {
  const clean = s.normalize("NFKC").replace(/[^\p{L}\p{N}._ -]+/gu, "_").replace(/\s+/g, " ").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, max);
  return clean || "item";
}

/** CSV cell; leading = + - @ are defused so a spreadsheet won't run them as formulas. */
export function csvCell(v: unknown): string {
  let s = v === undefined || v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const MANIFEST_COLUMNS = ["app", "id", "kind", "title", "owner", "participants", "date", "deleted", "file", "attachments", "sha256"] as const;

export class ExportZip {
  readonly files: ZipFile[] = [];
  readonly counts: Record<string, AppCount> = {};
  private zip: Zip;
  private used = new Set<string>();
  private rows: string[] = [MANIFEST_COLUMNS.join(",")];
  private failed: Error | null = null;

  constructor(sink: (chunk: Uint8Array, final: boolean) => void) {
    this.zip = new Zip((err, data, final) => {
      if (err) {
        this.failed = err;
        return;
      }
      sink(data, final);
    });
  }

  private unique(path: string): string {
    if (!this.used.has(path.toLowerCase())) {
      this.used.add(path.toLowerCase());
      return path;
    }
    const dot = path.lastIndexOf(".");
    const [stem, ext] = dot > path.lastIndexOf("/") ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
    for (let i = 2; ; i++) {
      const p = `${stem} (${i})${ext}`;
      if (!this.used.has(p.toLowerCase())) {
        this.used.add(p.toLowerCase());
        return p;
      }
    }
  }

  /** Adds one file; returns the path it got (made unique) and its SHA-256. */
  addFile(path: string, data: Uint8Array, compress = true): ZipFile {
    if (this.failed) throw this.failed;
    const p = this.unique(path);
    const entry = compress ? new ZipDeflate(p, { level: 6 }) : new ZipPassThrough(p);
    entry.mtime = new Date();
    this.zip.add(entry);
    entry.push(data, true);
    const f = { path: p, size: data.length, sha256: sha256(data) };
    this.files.push(f);
    return f;
  }

  count(app: string): AppCount {
    return (this.counts[app] ??= { items: 0, attachments: 0, skippedAttachments: 0, missing: 0 });
  }

  /** Adds one item: its JSON (attachments listed with the file each was saved as) and its attachments. */
  addItem(item: ExportItem): void {
    const app = safeName(item.app || "app", 40);
    const base = `${app}/${safeName(`${item.kind || "item"}-${item.id}`, 100)}`;
    const c = this.count(item.app);
    const attachments: Record<string, unknown>[] = [];
    const attachmentFiles: string[] = [];
    // The item's own path first, so its attachments' folder matches it.
    const jsonPath = this.unique(`${base}.json`);
    this.used.delete(jsonPath.toLowerCase());
    const folder = jsonPath.slice(0, -".json".length);
    for (const a of item.attachments ?? []) {
      const { base64, ...meta } = a;
      if (base64 && !a.skipped) {
        const f = this.addFile(`${folder}/${safeName(a.name || "attachment", 120)}`, Buffer.from(base64, "base64"), false);
        attachments.push({ ...meta, file: f.path, sha256: f.sha256 });
        attachmentFiles.push(f.path);
        c.attachments++;
      } else {
        attachments.push({ ...meta, skipped: a.skipped || "No content sent" });
        c.skippedAttachments++;
      }
    }
    const json = strToU8(JSON.stringify({ ...item, attachments }, null, 2));
    const f = this.addFile(jsonPath, json);
    c.items++;
    this.rows.push(
      [item.app, item.id, item.kind, item.title, item.owner, (item.participants ?? []).join("; "), item.date, item.deleted ? "yes" : "", f.path, attachmentFiles.join("; "), f.sha256]
        .map(csvCell)
        .join(","),
    );
  }

  /** Writes manifest.csv and summary.json and ends the zip. Returns the summary. */
  finish(about: Record<string, unknown>): Record<string, unknown> {
    const manifest = this.addFile("manifest.csv", strToU8(this.rows.join("\r\n") + "\r\n"));
    const totals = Object.values(this.counts).reduce(
      (t, c) => ({ items: t.items + c.items, attachments: t.attachments + c.attachments, skippedAttachments: t.skippedAttachments + c.skippedAttachments }),
      { items: 0, attachments: 0, skippedAttachments: 0 },
    );
    const summary = { ...about, counts: this.counts, totals, manifest: manifest.path, files: [...this.files] };
    this.addFile("summary.json", strToU8(JSON.stringify(summary, null, 2)));
    this.zip.end();
    if (this.failed) throw this.failed;
    return summary;
  }
}
