// Get data from the web: fetches an address for a signed-in user, under the
// rules in lib/safe-fetch (public addresses only, size and time limits).
import { NextRequest, NextResponse } from "next/server";
import { identity } from "@/lib/identity";
import { FetchRefused, safeFetch } from "@/lib/safe-fetch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "Sign in to get data." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url || url.length > 4096) return NextResponse.json({ error: "Enter a web address." }, { status: 400 });
  try {
    const got = await safeFetch(url);
    return NextResponse.json({ contentType: got.contentType, text: got.text, url: got.url });
  } catch (e) {
    const message = e instanceof FetchRefused ? e.message : "The address could not be reached.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
