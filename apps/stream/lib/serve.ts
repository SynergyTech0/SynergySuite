import { readWeb, size } from "./store";

/** "bytes=0-1023" → inclusive start and end inside a file of `total` bytes; null when absent or unusable. */
export function parseRange(header: string | null, total: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header ?? "").trim());
  if (!m || total <= 0 || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    // The last N bytes.
    start = Math.max(0, total - Number(m[2]));
    end = total - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
  }
  return start <= end && start < total ? { start, end } : null;
}

/** RFC 6266 filename for downloads: ASCII fallback plus the real name. */
export function disposition(kind: "inline" | "attachment", name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * A file from disk with range support (video players seek with ranges). Bytes are never run as a
 * page here: no sniffing, and a sandbox in case someone opens the URL directly.
 */
export async function fileResponse(
  req: Request,
  file: string,
  opts: { type: string; name?: string; download?: boolean; cache?: string },
): Promise<Response> {
  const total = await size(file);
  if (total === null) return new Response("Not found", { status: 404 });
  const headers: Record<string, string> = {
    "Content-Type": opts.type,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Cache-Control": opts.cache ?? "private, max-age=300",
  };
  if (opts.name) headers["Content-Disposition"] = disposition(opts.download ? "attachment" : "inline", opts.name);
  const header = req.headers.get("range");
  const range = parseRange(header, total);
  if (header && !range) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${total}` } });
  if (req.method === "HEAD") return new Response(null, { headers: { ...headers, "Content-Length": String(total) } });
  if (range) {
    return new Response(readWeb(file, range), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${total}`, "Content-Length": String(range.end - range.start + 1) },
    });
  }
  return new Response(total ? readWeb(file) : null, { headers: { ...headers, "Content-Length": String(total) } });
}

/** WebVTT text as a <track> source. */
export function vttResponse(vtt: string): Response {
  return new Response(vtt, {
    headers: { "Content-Type": "text/vtt; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-cache" },
  });
}
