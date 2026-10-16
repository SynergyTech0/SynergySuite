import { NextResponse } from "next/server";
import { labelById } from "@synergy/compliance";
import { route, accountFor } from "@/lib/api";
import { UserError } from "@/lib/accounts";
import { sendMessage } from "@/lib/mailbox";
import { checkDemoSend } from "@/lib/demo";
import { policy } from "@/lib/policy";
import { addressOf, applyLabel, blockedRecipients, dlpIncident, dlpOutcome, outgoingText } from "@/lib/protection";

export const dynamic = "force-dynamic";

const MAX_ATTACHMENTS = 25 * 1024 * 1024;
const list = (v: FormDataEntryValue | null) =>
  String(v || "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);

/** dlpOverride: a JSON field {"justification": "..."} sent when the person goes ahead after a warning. */
function override(v: FormDataEntryValue | null): { justification?: unknown } | null {
  if (typeof v !== "string" || !v) return null;
  try {
    const o = JSON.parse(v);
    return o && typeof o === "object" ? o : null;
  } catch {
    throw new UserError("dlpOverride must be JSON");
  }
}

export const POST = route(async (ctx, req) => {
  const form = await req.formData();
  const acct = await accountFor(ctx, String(form.get("account") || ""));
  const files = form.getAll("attachments").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f);
  if (files.reduce((n, f) => n + f.size, 0) > MAX_ATTACHMENTS) throw new UserError("Attachments are limited to 25 MB in total");
  const all = [...list(form.get("to")), ...list(form.get("cc")), ...list(form.get("bcc"))];
  const bad = all.find((a) => !/^[^@\s<>]+@[^@\s<>]+$/.test(a.replace(/^.*<([^>]+)>$/, "$1")));
  if (bad) throw new UserError(`"${bad}" is not an email address`);
  checkDemoSend(acct.id, all);
  const recipients = [...new Set(all.map(addressOf))];

  const labelId = String(form.get("labelId") || "") || null;
  const label = labelId ? labelById(await policy().labels(), labelId) : null;
  if (labelId && !label) throw new UserError("That sensitivity label no longer exists. Pick another one.");
  const outside = blockedRecipients(label, recipients, (await policy().dlpSettings()).internalDomains);
  if (outside.length) {
    return NextResponse.json({
      error: `Mail labeled ${label!.name} can't be sent outside the organization. Remove ${outside.join(", ")}, or change the label.`,
      outside,
    }, { status: 422 });
  }

  const message = {
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
  };

  // Data loss prevention, on what the recipients would get (before the label's marking is added).
  const decision = await policy().checkDlp({ text: outgoingText(message), labelId: label?.id ?? null, recipients });
  const outcome = dlpOutcome(decision, override(form.get("dlpOverride")));
  const incident = dlpIncident(decision, outcome, { actor: ctx.user, title: message.subject, recipients, labelId: label?.id ?? null });
  if (!outcome.send) {
    if (incident) void policy().reportDlp(incident);
    return NextResponse.json(outcome.body, { status: outcome.status });
  }
  const sent = await sendMessage(acct, applyLabel(message, label));
  if (incident) void policy().reportDlp(incident); // never throws; a lost report doesn't fail a sent message
  return sent;
});
