import { htmlPage } from "@/lib/api";
import { publicForm, rateLimited, signup, type PublicForm } from "@/lib/forms";
import { UserError, escapeHtml } from "@/lib/util";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ id: string }> };

function formHtml(f: PublicForm, error = "", v: Record<string, string> = {}): string {
  return `<h1>${escapeHtml(f.name)}</h1>${f.intro ? `<p>${escapeHtml(f.intro).replace(/\n/g, "<br>")}</p>` : ""}
${error ? `<p style="color:#c4314b">${escapeHtml(error)}</p>` : ""}
<form method="post">
<label for=email>Email</label><input type="email" id=email name="email" required maxlength=254 value="${escapeHtml(v.email ?? "")}" autocomplete="email">
<label for=fn>First name</label><input type="text" id=fn name="first_name" maxlength=100 value="${escapeHtml(v.first_name ?? "")}" autocomplete="given-name">
<label for=ln>Last name</label><input type="text" id=ln name="last_name" maxlength=100 value="${escapeHtml(v.last_name ?? "")}" autocomplete="family-name">
<div class="hp" aria-hidden="true"><label>Leave this empty<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<label class="check"><input type="checkbox" name="consent" value="1" required> I agree to receive email from ${escapeHtml(f.orgName || f.name)}. I can unsubscribe at any time.</label>
<button>Subscribe</button></form>`;
}

const notFound = () => htmlPage("Not found", "<h1>This signup form isn't available</h1>", 404);

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";
}

export async function GET(_req: Request, { params }: P) {
  const f = await publicForm((await params).id);
  return f ? htmlPage(f.name, formHtml(f)) : notFound();
}

export async function POST(req: Request, { params }: P) {
  const f = await publicForm((await params).id);
  if (!f) return notFound();
  const data = await req.formData().catch(() => new FormData());
  const v: Record<string, string> = {};
  for (const k of ["email", "first_name", "last_name", "website", "consent"]) v[k] = String(data.get(k) ?? "");
  // Bots fill the hidden field; tell them it worked and do nothing.
  if (v.website) return htmlPage("Thanks", "<h1>Thanks!</h1>");
  if (rateLimited(clientIp(req))) return htmlPage(f.name, formHtml(f, "Too many signups from here. Wait a minute and try again.", v), 429);
  if (v.consent !== "1") return htmlPage(f.name, formHtml(f, "Tick the box to agree to receive email.", v), 400);
  try {
    const res = await signup(f, v, clientIp(req));
    return htmlPage("Thanks", res === "confirm-sent"
      ? `<h1>Check your inbox</h1><p>We sent a link to ${escapeHtml(v.email)}. Click it to confirm your subscription.</p>`
      : `<h1>You're subscribed</h1><p>Thanks for joining ${escapeHtml(f.name)}.</p>`);
  } catch (e) {
    if (e instanceof UserError) return htmlPage(f.name, formHtml(f, e.message, v), e.status);
    throw e;
  }
}
