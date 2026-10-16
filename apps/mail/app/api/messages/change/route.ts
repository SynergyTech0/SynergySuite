import { route, accountFor, uidParam } from "@/lib/api";
import { UserError } from "@/lib/accounts";
import { changeMessages, type Change } from "@/lib/mailbox";

export const dynamic = "force-dynamic";

const ACTIONS = new Set(["read", "unread", "flag", "unflag", "move", "delete", "archive", "junk"]);

export const POST = route(async (ctx, req) => {
  const b = await req.json().catch(() => ({}));
  const acct = await accountFor(ctx, String(b.account || ""));
  const uids = (Array.isArray(b.uids) ? b.uids : []).map(uidParam);
  const action = String(b.action || "");
  if (!ACTIONS.has(action)) throw new UserError("Unknown action");
  if (action === "move" && !b.to) throw new UserError("Choose a folder to move to");
  await changeMessages(acct, String(b.folder || ""), uids, { action, to: String(b.to || "") } as Change);
  return { ok: true };
});
