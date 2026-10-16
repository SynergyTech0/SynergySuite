import { NextResponse } from "next/server";
import { runOp } from "@/lib/connect";
import { keyOwner } from "@/lib/keys";
import { fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Called by the Synergy piece inside the flow engine, never by a browser: the person is the one
 * the Synergy key in the Authorization header belongs to.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const auth = req.headers.get("authorization") || "";
    const owner = auth.startsWith("Bearer ") ? keyOwner(auth.slice(7).trim()) : null;
    if (!owner) return NextResponse.json({ error: "That Synergy key isn't valid. Open Synergy Flow again to renew your connection." }, { status: 401 });
    let payload: { op?: unknown; input?: unknown };
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: "Bad request body" }, { status: 400 });
    }
    const out = await runOp(String(payload?.op ?? ""), payload?.input, owner);
    return NextResponse.json(out ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return fail(err);
  }
}
