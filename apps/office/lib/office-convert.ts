// Document conversion through a local LibreOffice (headless soffice): .docx
// to PDF, OpenDocument or RTF, and .odt, .rtf or .doc to .docx. Each run gets
// its own temporary folder and LibreOffice profile.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type InFormat = "docx" | "odt" | "rtf" | "doc";
export type OutFormat = "pdf" | "docx" | "odt" | "rtf";

export function localOffice(): string | null {
  for (const p of ["/usr/bin/soffice", "/usr/bin/libreoffice", "/usr/local/bin/soffice", "/opt/libreoffice/program/soffice"]) if (existsSync(p)) return p;
  return null;
}

/** What a file is, from its first bytes (not its name). */
export function sniffFormat(b: Uint8Array): InFormat | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (ascii(0, 5) === "{\\rtf") return "rtf";
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return "doc";
  if (b[0] === 0x50 && b[1] === 0x4b) {
    // OpenDocument stores its "mimetype" file first, uncompressed
    if (ascii(30, 38) === "mimetype" && ascii(38, 77).startsWith("application/vnd.oasis.opendocument.text")) return "odt";
    return "docx";
  }
  return null;
}

const FILTER: Record<OutFormat, string> = { pdf: "pdf", docx: "docx:MS Word 2007 XML", odt: "odt", rtf: "rtf" };

export async function convertLocally(bin: string, bytes: Uint8Array, from: InFormat, to: OutFormat): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(tmpdir(), "docs-convert-"));
  try {
    const src = path.join(dir, `in.${from}`);
    await writeFile(src, bytes);
    const out = path.join(dir, "out");
    await new Promise<void>((resolve, reject) =>
      execFile(bin, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", FILTER[to], "--outdir", out, src], { timeout: 120000 }, (e) => (e ? reject(e) : resolve())),
    );
    return new Uint8Array(await readFile(path.join(out, `in.${to}`)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
