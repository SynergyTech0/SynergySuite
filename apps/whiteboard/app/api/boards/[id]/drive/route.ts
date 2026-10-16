import { type Params, route } from "@/lib/api";
import * as boards from "@/lib/boards";
import { fileName, saveToDrive } from "@/lib/drive";
import { UserError } from "@/lib/util";

const FORMATS: Record<string, string> = { excalidraw: "application/json", png: "image/png", svg: "image/svg+xml" };
const MAX_BYTES = 60 * 1024 * 1024;

/**
 * Saves a copy of the board into the person's Drive (Whiteboards folder). The browser sends the
 * file it made (?format=excalidraw, png or svg); anyone who can view the board can keep a copy.
 */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  const board = await boards.getBoard(me, id);
  const format = new URL(req.url).searchParams.get("format") ?? "excalidraw";
  const type = FORMATS[format];
  if (!type) throw new UserError("Save as .excalidraw, .png or .svg");
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) throw new UserError("That board is too big to save", 413);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.byteLength) throw new UserError("Nothing to save");
  if (bytes.byteLength > MAX_BYTES) throw new UserError("That board is too big to save", 413);
  return saveToDrive(me, fileName(board.title, format), bytes, type);
});
