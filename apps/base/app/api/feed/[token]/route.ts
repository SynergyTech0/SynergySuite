import { NextResponse } from "next/server";
import { resolveLink } from "@/lib/dataLinks";
import { csvHeaders, queryCsv, tableCsv } from "@/lib/exportCsv";
import { HttpError } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/feed/<token>.csv: a data link's table or query as CSV, without signing in (the
 * gateway lets this path through; the token is the key).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  try {
    const src = await resolveLink(token.replace(/\.csv$/, ""));
    const headers = { ...csvHeaders("", false), "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
    if (src.kind === "table") return new Response(tableCsv(src.table), { headers });
    return new Response(await queryCsv(src.query, src.email), { headers });
  } catch (e) {
    // Every failure looks the same from outside, so a link reveals nothing once it's off.
    if (e instanceof HttpError && e.status < 500) return NextResponse.json({ error: "Not found" }, { status: 404 });
    console.error(e);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
