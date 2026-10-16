import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/session";
import { isOwner, openShare } from "@/lib/store";
import { sharedView } from "@/lib/share";

type Ctx = { params: Promise<{ token: string }> };

/** What anyone holding the link sees: the file's name and size, and the review comments. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { token } = await params;
  const open = await openShare(token);
  if (!open) return NextResponse.json({ error: "This link isn't shared any more" }, { status: 404 });
  const me = await currentUser();
  return NextResponse.json(sharedView(open.file, open.share, !!me && isOwner(open.share, me.subject)), {
    headers: { "Cache-Control": "private, no-cache", "X-Robots-Tag": "noindex" },
  });
}
