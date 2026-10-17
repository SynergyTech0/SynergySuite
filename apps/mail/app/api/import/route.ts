import { accountFor, route, uidParam } from "@/lib/api";
import { UserError } from "@/lib/accounts";
import { MAX_IMPORT_BYTES, appendMessage, cleanPlace, updateMessage } from "@/lib/importer";

export const dynamic = "force-dynamic";

/**
 * Migration into the signed-in person's suite mailbox (the Admin center calls this on their
 * behalf with the gateway headers). Creates the mailbox first if it doesn't exist yet.
 *
 * PUT: the body is one raw message (RFC 5322). ?role=inbox|sent|drafts|trash|junk|archive and
 * ?path=["Projects","2024"] (JSON) say where it goes; ?seen=1, ?flagged=1 and ?date=<ISO> keep
 * its state and received date. Answers { folder, uid }.
 */
export const PUT = route(async (ctx, req) => {
  const url = new URL(req.url);
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_IMPORT_BYTES) throw new UserError("The message is too large", 413);
  let path: unknown = [];
  try {
    path = JSON.parse(url.searchParams.get("path") || "[]");
  } catch {
    throw new UserError("Bad folder path");
  }
  const place = cleanPlace(url.searchParams.get("role"), path);
  const raw = Buffer.from(await req.arrayBuffer());
  const date = url.searchParams.get("date");
  const acct = await accountFor(ctx, "suite");
  return appendMessage(acct, raw, place, {
    seen: url.searchParams.get("seen") === "1",
    flagged: url.searchParams.get("flagged") === "1",
    date: date ? new Date(date) : null,
  });
});

/**
 * POST { folder, uid, seen, flagged, moveTo?: { role, path } }: brings a copied message up to
 * date. Answers { folder, uid }, or { gone: true } when it is no longer there.
 */
export const POST = route(async (ctx, req) => {
  const b = await req.json().catch(() => ({}));
  const folder = String(b.folder || "");
  if (!folder) throw new UserError("Missing folder");
  const moveTo = b.moveTo && typeof b.moveTo === "object" ? cleanPlace(b.moveTo.role, b.moveTo.path) : null;
  const acct = await accountFor(ctx, "suite");
  const out = await updateMessage(acct, { folder, uid: uidParam(b.uid) }, { seen: b.seen === true, flagged: b.flagged === true }, moveTo);
  return out ?? { gone: true };
});
