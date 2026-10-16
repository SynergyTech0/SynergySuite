import { createHash } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ExportZip, csvCell, safeName } from "../lib/zip";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function build(fn: (z: ExportZip) => void): { files: Record<string, Uint8Array>; summary: Record<string, unknown> } {
  const chunks: Uint8Array[] = [];
  const z = new ExportZip((c) => chunks.push(c));
  fn(z);
  const summary = z.finish({ exportedBy: "admin@example.com", search: { query: "contract" } });
  return { files: unzipSync(Buffer.concat(chunks)), summary };
}

describe("export zip", () => {
  it("writes a folder per app, item JSON, attachments, manifest and summary with hashes", () => {
    const { files, summary } = build((z) => {
      z.addItem({
        app: "mail", id: "INBOX/42", kind: "message", title: "Hello, \"world\"", owner: "alice@example.com", participants: ["bob@example.com"],
        date: "2026-09-01T00:00:00Z", snippet: "", metadata: { folder: "INBOX" }, text: "hi",
        attachments: [
          { name: "a.txt", type: "text/plain", size: 5, base64: Buffer.from("hello").toString("base64") },
          { name: "big.iso", type: "application/octet-stream", size: 10 ** 9, skipped: "Larger than 25 MB" },
        ],
      });
      z.addItem({ app: "drive", id: "f1", kind: "file", title: "=SUM(A1)", owner: "bob@example.com", date: "2026-09-02T00:00:00Z", snippet: "", metadata: {}, deleted: true });
    });
    const names = Object.keys(files).sort();
    expect(names).toEqual(["drive/file-f1.json", "mail/message-INBOX_42.json", "mail/message-INBOX_42/a.txt", "manifest.csv", "summary.json"]);
    expect(strFromU8(files["mail/message-INBOX_42/a.txt"])).toBe("hello");

    const item = JSON.parse(strFromU8(files["mail/message-INBOX_42.json"]));
    expect(item.attachments[0]).toMatchObject({ name: "a.txt", file: "mail/message-INBOX_42/a.txt", sha256: sha(Buffer.from("hello")) });
    expect(item.attachments[0].base64).toBeUndefined();
    expect(item.attachments[1].skipped).toBe("Larger than 25 MB");

    const manifest = strFromU8(files["manifest.csv"]).trim().split("\r\n");
    expect(manifest[0]).toBe("app,id,kind,title,owner,participants,date,deleted,file,attachments,sha256");
    expect(manifest[1]).toContain('"Hello, ""world"""');
    expect(manifest[2]).toContain("'=SUM(A1)");
    expect(manifest[2]).toContain(",yes,");

    const s = JSON.parse(strFromU8(files["summary.json"]));
    expect(s).toEqual(JSON.parse(JSON.stringify(summary)));
    expect(s.exportedBy).toBe("admin@example.com");
    expect(s.counts.mail).toMatchObject({ items: 1, attachments: 1, skippedAttachments: 1 });
    expect(s.totals).toEqual({ items: 2, attachments: 1, skippedAttachments: 1 });
    for (const f of s.files as { path: string; sha256: string; size: number }[]) {
      expect(sha(files[f.path])).toBe(f.sha256);
      expect(files[f.path].length).toBe(f.size);
    }
    expect((s.files as { path: string }[]).map((f) => f.path)).toContain("manifest.csv");
  });

  it("keeps paths unique when ids clash after cleaning", () => {
    const { files } = build((z) => {
      for (const id of ["a/b", "a:b", "a?b"]) z.addItem({ app: "drive", id, kind: "file", title: id, owner: "x@example.com", date: "", snippet: "", metadata: {} });
    });
    expect(Object.keys(files).filter((n) => n.startsWith("drive/")).sort()).toEqual(["drive/file-a_b (2).json", "drive/file-a_b (3).json", "drive/file-a_b.json"]);
  });

  it("cleans names and CSV cells", () => {
    expect(safeName("../../etc/passwd")).toBe("_.._etc_passwd");
    expect(safeName("   ")).toBe("item");
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(undefined)).toBe("");
  });
});
