import { htmlPage } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { findDelivery, resubscribe, unsubscribe } from "@/lib/tracking";
import { escapeHtml } from "@/lib/util";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ token: string }> };

const missing = () => htmlPage("Not found", "<h1>We couldn't find that subscription</h1><p class=muted>The link may be incomplete. Copy the whole link from the email and try again.</p>", 404);

/**
 * The unsubscribe page from an email's footer. Opening it changes nothing (mail scanners open
 * links); the buttons post back here. The List-Unsubscribe header's one-click POST (RFC 8058)
 * also lands here and unsubscribes straight away.
 */
export async function GET(_req: Request, { params }: P) {
  const d = await findDelivery((await params).token);
  if (!d) return missing();
  const s = await getSettings();
  const list = escapeHtml(d.audience_name || "this list");
  const who = escapeHtml(s.orgName || "us");
  if (d.sub_status === "unsubscribed" || d.unsubscribed_at) {
    return htmlPage("Unsubscribed", `<h1>You're unsubscribed</h1><p>${escapeHtml(d.email)} won't get more email from ${list}.</p>
<form method="post"><input type="hidden" name="action" value="resubscribe"><button class="secondary" style="margin-left:0">I unsubscribed by mistake</button></form>`);
  }
  return htmlPage("Unsubscribe", `<h1>Unsubscribe</h1><p>Stop sending ${escapeHtml(d.email)} email from <strong>${list}</strong>?</p>
<form method="post"><input type="hidden" name="action" value="unsubscribe">
<label class="check"><input type="checkbox" name="everything" value="1"> Also stop all other email from ${who}</label>
<button>Unsubscribe</button></form>`);
}

export async function POST(req: Request, { params }: P) {
  const d = await findDelivery((await params).token);
  if (!d) return missing();
  const form = await req.formData().catch(() => new FormData());
  const oneClick = form.get("List-Unsubscribe") === "One-Click";
  if (oneClick) {
    await unsubscribe(d, false);
    return new Response(null, { status: 200 });
  }
  if (form.get("action") === "resubscribe") {
    const ok = await resubscribe(d);
    return htmlPage("Subscribed", ok ? "<h1>You're subscribed again</h1><p>Thanks for staying.</p>" : "<h1>We can't resubscribe this address</h1><p class=muted>Email to it bounced or it was blocked. Sign up again with the form on our website.</p>");
  }
  const everything = form.get("everything") === "1";
  await unsubscribe(d, everything);
  return htmlPage("Unsubscribed", `<h1>You're unsubscribed</h1><p>${escapeHtml(d.email)} won't get ${everything ? "any more email from us" : `more email from ${escapeHtml(d.audience_name || "this list")}`}.</p>
<form method="post"><input type="hidden" name="action" value="resubscribe"><button class="secondary" style="margin-left:0">I unsubscribed by mistake</button></form>`);
}
