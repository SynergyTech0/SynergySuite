import { htmlPage } from "@/lib/api";
import { browserCopy, findDelivery } from "@/lib/tracking";

export const dynamic = "force-dynamic";

/** "View in your browser": the email as this person got it. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const d = await findDelivery((await params).token);
  const html = d ? await browserCopy(d) : null;
  if (!html) return htmlPage("Not found", "<h1>This email isn't available</h1>", 404);
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      // The email's own HTML, which we wrote: inline styles and remote images only, nothing that runs.
      "Content-Security-Policy": "default-src 'none'; img-src * data:; style-src 'unsafe-inline'; frame-ancestors 'none'",
    },
  });
}
