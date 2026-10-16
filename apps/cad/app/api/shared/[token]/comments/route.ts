import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/session";
import { addComment, removeComment } from "@/lib/store";
import { commentInput } from "@/lib/share";

type Ctx = { params: Promise<{ token: string }> };

/**
 * POST `{ text, name? }` adds a review comment. Signed-in people comment as themselves; anyone
 * else gives a name and is shown as a guest.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { token } = await params;
  const me = await currentUser();
  const input = commentInput(await req.json().catch(() => null), me ? me.name || me.email : null);
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });
  const comment = await addComment(token, input.author, !me, input.text);
  if (comment === null) return NextResponse.json({ error: "This link isn't shared any more" }, { status: 404 });
  if (comment === "full") return NextResponse.json({ error: "This drawing has as many comments as it can hold" }, { status: 409 });
  return NextResponse.json({ comment }, { status: 201 });
}

/** DELETE ?id=<comment> removes a comment. Only the file's owner can. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { token } = await params;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  return (await removeComment(token, me.subject, id)) ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
