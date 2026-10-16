import { body, route } from "@/lib/api";
import * as drive from "@/lib/drive";
import { UserError } from "@/lib/names";

type Action = { action?: string; ids?: string[]; target?: { parent?: string | null; library?: string | null } };

/** Changes to several items at once: delete, restore, delete forever, move, copy. */
export const POST = route(async (me, req) => {
  const b = await body<Action>(req);
  const ids = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 1000) : [];
  if (!ids.length) throw new UserError("Pick something first");
  const target = b.target ?? {};
  switch (b.action) {
    case "trash":
      return drive.moveToTrash(me, ids);
    case "restore":
      return drive.restore(me, ids);
    case "forever":
      return drive.deleteForever(me, ids);
    case "move":
      return drive.move(me, ids, target);
    case "copy":
      return drive.copy(me, ids, target);
    default:
      throw new UserError("Unknown action");
  }
});
