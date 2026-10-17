import { type Params, route } from "@/lib/api";
import { deleteNote } from "@/lib/workorders";

export const DELETE = route(async (me, _req, { params }: Params<"id" | "noteId">) => {
  const { id, noteId } = await params;
  await deleteNote(me.email, id, noteId);
});
