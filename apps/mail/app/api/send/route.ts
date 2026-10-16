import { route, accountFor } from "@/lib/api";
import { UserError } from "@/lib/accounts";
import { sendMessage } from "@/lib/mailbox";
import { checkDemoSend } from "@/lib/demo";

export const dynamic = "force-dynamic";

const MAX_ATTACHMENTS = 25 * 1024 * 1024;
const list = (v: FormDataEntryValue | null) =>
  String(v || "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);

export const POST = route(async (ctx, req) => {
  const form = await req.formData();
  const acct = await accountFor(ctx, String(form.get("account") || ""));
  const files = form.getAll("attachments").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f);
  if (files.reduce((n, f) => n + f.size, 0) > MAX_ATTACHMENTS) throw new UserError("Attachments are limited to 25 MB in total");
  const all = [...list(form.get("to")), ...list(form.get("cc")), ...list(form.get("bcc"))];
  const bad = all.find((a) => !/^[^@\s<>]+@[^@\s<>]+$/.test(a.replace(/^.*<([^>]+)>$/, "$1")));
  if (bad) throw new UserError(`"${bad}" is not an email address`);
  checkDemoSend(acct.id, all);
  return sendMessage(acct, {
    to: list(form.get("to")),
    cc: list(form.get("cc")),
    bcc: list(form.get("bcc")),
    subject: String(form.get("subject") || ""),
    html: String(form.get("html") || "") || undefined,
    text: String(form.get("text") || "") || undefined,
    inReplyTo: String(form.get("inReplyTo") || "") || undefined,
    references: list(form.get("references")).length ? String(form.get("references")).split(/\s+/).filter(Boolean) : undefined,
    attachments: await Promise.all(files.map(async (f) => ({
      filename: f.name, contentType: f.type || undefined, content: Buffer.from(await f.arrayBuffer()),
    }))),
  });
});
