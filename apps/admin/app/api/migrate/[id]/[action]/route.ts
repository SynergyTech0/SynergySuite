import { body, route, type Params } from "@/lib/api";
import { addMailbox, createAccounts, discover, map, removeMailbox, setSite, start } from "@/lib/migrate";
import { UserError } from "@/lib/util";

/**
 * discover: read users, sizes and sites from the source. map: [{ extId, target }].
 * accounts: create the missing suite accounts and mailboxes. start: queue copies.
 * mailbox / unmailbox: add or remove an IMAP mailbox. site: include a SharePoint site.
 */
export const POST = route("migrate", async (me, req, { params }: Params<"id" | "action">) => {
  const { id, action } = await params;
  const b = await body<Record<string, unknown>>(req);
  switch (action) {
    case "discover":
      return discover(me, id);
    case "map":
      return map(me, id, b.mappings);
    case "accounts":
      return createAccounts(me, id, b.extIds);
    case "start":
      return start(me, id, b);
    case "mailbox":
      return addMailbox(me, id, b);
    case "unmailbox":
      return removeMailbox(me, id, String(b.extId ?? ""));
    case "site":
      return setSite(me, id, b);
    default:
      throw new UserError("Not found", 404);
  }
});
