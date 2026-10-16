import { body, route } from "@/lib/api";
import * as boards from "@/lib/boards";
import { readFromDrive } from "@/lib/drive";
import { UserError, text } from "@/lib/util";
import { parseExcalidraw } from "@/lib/ydoc";

const MAX_CHARS = 50 * 1024 * 1024;

/**
 * A new board from an .excalidraw file: { driveItem } opens one from the person's Drive,
 * { title, content } one they picked on their computer.
 */
export const POST = route(async (me, req) => {
  const b = await body<{ driveItem?: string; title?: string; content?: string }>(req);
  if (b.driveItem) {
    const file = await readFromDrive(me, String(b.driveItem));
    return boards.importBoard(me, file.name.replace(/\.excalidraw$/i, "") || "Imported board", parseExcalidraw(file.text));
  }
  if (typeof b.content !== "string" || !b.content) throw new UserError("Pick a file to open");
  if (b.content.length > MAX_CHARS) throw new UserError("That file is too big to open", 413);
  return boards.importBoard(me, text(b.title, 120) || "Imported board", parseExcalidraw(b.content));
});
