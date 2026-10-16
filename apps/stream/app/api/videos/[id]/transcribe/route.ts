import { type Params, route } from "@/lib/api";
import { startCaptioning } from "@/lib/ai";
import { getVideo } from "@/lib/videos";

export const dynamic = "force-dynamic";

/** The owner asks for captions from the video's speech; they arrive in the background. */
export const POST = route(async (me, _req, { params }: Params<"id">) => {
  const { id } = await params;
  await startCaptioning(id, me.email);
  return { video: await getVideo(me, id) };
});
