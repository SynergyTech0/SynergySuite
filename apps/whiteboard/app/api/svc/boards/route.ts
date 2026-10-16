import { NextResponse } from "next/server";
import { appUrl } from "@synergy/config";
import { linkedBoard } from "@/lib/boards";
import { fromSuiteServer } from "@/lib/svc";
import { UserError, text } from "@/lib/util";

const SOURCE = /^(meet|chat):[A-Za-z0-9._:-]{1,200}$/;

/**
 * The board for a meeting or a chat channel, for the Meet and Chat servers:
 * { source: "meet:<room>" | "chat:<channel>", title, owner, people } -> { id, url, created }.
 * The calling server has already checked that `people` are in the meeting or channel; each of
 * them can edit the board from now on.
 */
export async function POST(req: Request): Promise<Response> {
  if (!(await fromSuiteServer())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const b = (await req.json().catch(() => null)) as { source?: unknown; title?: unknown; owner?: unknown; people?: unknown } | null;
    if (!b || typeof b.source !== "string" || !SOURCE.test(b.source)) throw new UserError("Bad source");
    const people = Array.isArray(b.people) ? b.people.filter((p): p is string => typeof p === "string") : [];
    const out = await linkedBoard({ source: b.source, title: text(b.title, 120) || "Whiteboard", owner: String(b.owner ?? ""), people });
    return NextResponse.json({ ...out, url: `${appUrl("whiteboard")}/b/${out.id}` });
  } catch (err) {
    if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[whiteboard] svc", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
