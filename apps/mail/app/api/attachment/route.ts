import { route, accountFor, param, uidParam } from "@/lib/api";
import { getAttachment } from "@/lib/mailbox";

export const dynamic = "force-dynamic";

// Types a browser may display inline; anything else is always downloaded.
const INLINE_SAFE = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/i;

export const GET = route(async (ctx, req) => {
  const url = new URL(req.url);
  const acct = await accountFor(ctx, param(url, "account"));
  const a = await getAttachment(acct, param(url, "folder"), uidParam(param(url, "uid")), Number(param(url, "index")));
  const inline = url.searchParams.get("inline") === "1" && INLINE_SAFE.test(a.contentType);
  const type = INLINE_SAFE.test(a.contentType) ? a.contentType : "application/octet-stream";
  return new Response(new Uint8Array(a.content), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, max-age=3600",
    },
  });
});
