import { NextResponse } from "next/server";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { publish } from "@/lib/bus";
import { logActivity } from "@/lib/activity";
import { canWrite, forbidden, notFound, requireCard } from "@/lib/authz";

/**
 * POST /api/attachments { cardId, url, name?, driveFileId? } — attach a link (or a SynergyDrive file
 * by id) to a card.
 *
 * The url is rendered as an href, so only http(s) is accepted: `javascript:` or `data:` in an href is
 * script injection with one click. Parsing with URL() and checking the protocol is the whole defence;
 * a regex on the string is not.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const cardId = String(body.cardId || "");
  const access = await requireCard(cardId);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();

  let url: URL;
  try {
    url = new URL(String(body.url || ""));
  } catch {
    return NextResponse.json({ error: "a valid http(s) url is required" }, { status: 400 });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return NextResponse.json({ error: "a valid http(s) url is required" }, { status: 400 });
  }

  const fallbackName = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || url.hostname);
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 200) : fallbackName;

  const [att] = await db.insert(attachments).values({
    cardId,
    name,
    url: url.toString(),
    driveFileId: typeof body.driveFileId === "string" ? body.driveFileId : null,
    mime: typeof body.mime === "string" ? body.mime.slice(0, 100) : null,
    createdBy: access.user.id,
  }).returning();

  await logActivity({ boardId: access.boardId, cardId, userId: access.user.id, type: "attachment_added", data: { attachmentId: att.id, name } });
  publish(access.boardId, { type: "changed" });
  return NextResponse.json(att, { status: 201 });
}
