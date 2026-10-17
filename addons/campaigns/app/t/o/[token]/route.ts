import { recordOpen } from "@/lib/tracking";

export const dynamic = "force-dynamic";

// A 1x1 transparent GIF.
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/** The open pixel. Always answers with the image, whatever happens to the count. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  await recordOpen((await params).token).catch((e) => console.error("[campaigns] open:", (e as Error).message));
  return new Response(GIF, { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, max-age=0", "Content-Length": String(GIF.length) } });
}
