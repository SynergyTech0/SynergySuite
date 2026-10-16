import { type Params, body, route } from "@/lib/api";
import { type VideoChanges, deleteVideo, getVideo, updateVideo } from "@/lib/videos";

export const dynamic = "force-dynamic";

export const GET = route(async (me, _req, { params }: Params<"id">) => ({ video: await getVideo(me, (await params).id) }));

/** The owner changes the title, description, who can watch, comments, chapters or summary. */
export const PATCH = route(async (me, req, { params }: Params<"id">) => ({
  video: await updateVideo(me, (await params).id, await body<VideoChanges>(req)),
}));

export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteVideo(me, (await params).id);
  return { ok: true };
});
