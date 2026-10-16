import { Zip, ZipPassThrough } from "fflate";
import * as blobs from "./blobs";
import { UserError, disposition, parseRange, previewKind, servedType } from "./names";

/**
 * Headers for file bytes served from the Drive origin. Uploaded HTML, SVG or script must never
 * run as a page here, so everything is sniff-proof and sandboxed. PDFs are left out of the
 * sandbox only because browsers refuse to show them in their viewer otherwise; a PDF viewer
 * does not run the page's script.
 */
function safety(mime: string): Record<string, string> {
  const h: Record<string, string> = { "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" };
  if (mime !== "application/pdf") {
    h["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'";
  }
  return h;
}

export function fileResponse(
  req: Request,
  file: { name: string; mime: string; sha: string; size: number },
  inline: boolean,
): Response {
  const show = inline && previewKind(file.mime) !== "none";
  const headers: Record<string, string> = {
    ...safety(file.mime),
    "Content-Type": servedType(file.mime),
    "Content-Disposition": disposition(show ? "inline" : "attachment", file.name),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-cache",
    ETag: `"${file.sha}"`,
  };
  if (req.headers.get("if-none-match") === headers.ETag) return new Response(null, { status: 304, headers });
  const range = parseRange(req.headers.get("range"), file.size);
  if (req.headers.get("range") && !range && file.size > 0) {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${file.size}` } });
  }
  if (range) {
    return new Response(blobs.readWeb(file.sha, range), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${file.size}`, "Content-Length": String(range.end - range.start + 1) },
    });
  }
  return new Response(file.size ? blobs.readWeb(file.sha) : null, { headers: { ...headers, "Content-Length": String(file.size) } });
}

type Entry = { path: string; sha: string | null; kind: string; size: number; modified: Date };

/** A folder as a zip, streamed: files are stored as they are (most are compressed already). */
export function zipResponse(name: string, entries: Entry[], maxBytes: number): Response {
  const total = entries.reduce((n, e) => n + (e.kind === "file" ? e.size : 0), 0);
  if (total > maxBytes) throw new UserError("This folder is too big to download as one zip; download its folders one at a time", 413);

  let pulled: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        const zip = new Zip((err, chunk, final) => {
          if (err) return controller.error(err);
          controller.enqueue(chunk);
          if (final) controller.close();
        });
        (async () => {
          for (const e of entries) {
            if (e.kind === "folder") {
              const dir = new ZipPassThrough(`${e.path}/`);
              dir.mtime = e.modified;
              zip.add(dir);
              dir.push(new Uint8Array(0), true);
              continue;
            }
            const file = new ZipPassThrough(e.path);
            file.mtime = e.modified;
            zip.add(file);
            if (e.sha && e.size) {
              for await (const chunk of blobs.read(e.sha)) {
                file.push(chunk as Uint8Array);
                // Wait for the browser to take what's queued before reading more.
                while ((controller.desiredSize ?? 1) <= 0) await new Promise<void>((r) => (pulled = r));
              }
            }
            file.push(new Uint8Array(0), true);
          }
          zip.end();
        })().catch((err) => controller.error(err));
      },
      pull() {
        pulled?.();
        pulled = null;
      },
    },
    { highWaterMark: 4 * 1024 * 1024, size: (c) => c.byteLength },
  );
  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": disposition("attachment", `${name}.zip`),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
