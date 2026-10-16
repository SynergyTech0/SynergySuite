import { type Params, route } from "@/lib/api";
import { summarize } from "@/lib/ai";
import { getVideo } from "@/lib/videos";
import { UserError } from "@/lib/util";

export const dynamic = "force-dynamic";

/** A suggested summary and chapters from the transcript, for the owner to look over and save. */
export const POST = route(async (me, _req, { params }: Params<"id">) => {
  const { id } = await params;
  const v = await getVideo(me, id);
  if (!v.can_edit) throw new UserError("Not found", 404);
  return { suggestion: await summarize(id, me.email) };
});
