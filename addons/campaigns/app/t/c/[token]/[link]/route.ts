import { htmlPage } from "@/lib/api";
import { recordClick } from "@/lib/tracking";

export const dynamic = "force-dynamic";

/** A tracked link: counts the click and sends the reader on to the link the email held. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; link: string }> }) {
  const { token, link } = await params;
  const to = await recordClick(token, Number(link)).catch((e) => {
    console.error("[campaigns] click:", (e as Error).message);
    return null;
  });
  if (!to) return htmlPage("Link not found", "<h1>This link doesn't work any more</h1><p class=muted>The email it came from may have been deleted.</p>", 404);
  return new Response(null, { status: 302, headers: { Location: to, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
