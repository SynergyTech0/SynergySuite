import { htmlPage } from "@/lib/api";
import { confirm, pendingByToken } from "@/lib/forms";
import { escapeHtml } from "@/lib/util";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ token: string }> };

const gone = () => htmlPage("Link expired", "<h1>This link has already been used</h1><p class=muted>If you confirmed before, you're subscribed.</p>", 404);

/** Double opt-in: opening the link shows a button (mail scanners open links); the button confirms. */
export async function GET(_req: Request, { params }: P) {
  const p = await pendingByToken((await params).token);
  if (!p) return gone();
  return htmlPage("Confirm", `<h1>Confirm your subscription</h1><p>Subscribe ${escapeHtml(p.email)} to <strong>${escapeHtml(p.audienceName)}</strong>?</p>
<form method="post"><button>Yes, subscribe me</button></form>`);
}

export async function POST(_req: Request, { params }: P) {
  const done = await confirm((await params).token);
  if (!done) return gone();
  return htmlPage("Subscribed", `<h1>You're subscribed</h1><p>${escapeHtml(done.email)} will now get email from ${escapeHtml(done.audienceName)}.</p>`);
}
