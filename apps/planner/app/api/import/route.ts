import { NextResponse } from "next/server";
import { getCurrentUserOrNull } from "@/lib/session";
import { notFound } from "@/lib/authz";
import { createBoardFrom } from "@/lib/create-board";
import { readTrelloExport } from "@/lib/import-trello";
import { readJiraCsv } from "@/lib/import-jira-csv";

/**
 * POST /api/import — { kind: "trello" | "jira", text, title? } → a new board in the caller's own
 * workspace. The file is parsed before anything is written, so a bad file is a 400 with a sentence
 * the person can act on rather than half a board.
 */
const MAX = 20 * 1024 * 1024;   // a Trello export of a busy board is a few MB; 20 is generous

export async function POST(req: Request) {
  const user = await getCurrentUserOrNull();
  if (!user) return notFound();

  const body = await req.json().catch(() => null);
  const kind = body?.kind;
  const text = typeof body?.text === "string" ? body.text : "";
  if (kind !== "trello" && kind !== "jira") return NextResponse.json({ error: "kind must be trello or jira" }, { status: 400 });
  if (!text.trim()) return NextResponse.json({ error: "there was nothing in that file" }, { status: 400 });
  if (text.length > MAX) return NextResponse.json({ error: "that file is larger than 20MB" }, { status: 413 });

  let spec;
  try {
    spec = kind === "trello" ? readTrelloExport(text) : readJiraCsv(text, String(body.title || "Imported from Jira"));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "that file could not be read" }, { status: 400 });
  }
  if (typeof body.title === "string" && body.title.trim()) spec.title = body.title.trim();
  if (!spec.lists.length) return NextResponse.json({ error: "that file has no lists or issues to import" }, { status: 400 });

  const made = await createBoardFrom(spec, user.id, user.name);
  return NextResponse.json(made, { status: 201 });
}
