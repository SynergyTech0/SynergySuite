import { route } from "@/lib/api";
import { importContacts } from "@/lib/contacts";
import { parseContactsCsv } from "@/lib/csv";
import { readBody } from "@/lib/serve";
import { UserError } from "@/lib/util";
import { parseVCards } from "@/lib/vcard";

/** The browser sends the file's bytes as the body; vCard or CSV is told apart by what's inside. */
export const POST = route(async (me, req) => {
  const raw = (await readBody(req, 20 * 1024 * 1024)).toString("utf8");
  const parsed = /BEGIN:VCARD/i.test(raw) ? parseVCards(raw) : parseContactsCsv(raw);
  if (!parsed.length) throw new UserError("No contacts found. Pick a .vcf file or a CSV exported from Google or Outlook.");
  return importContacts(me.email, parsed);
});
