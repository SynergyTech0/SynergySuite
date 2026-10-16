import { type Params, route } from "@/lib/api";
import { MAX_CAPTIONS } from "@/lib/captions";
import { vttResponse } from "@/lib/serve";
import { clearCaptions, mediaFor, setCaptions } from "@/lib/videos";
import { UserError } from "@/lib/util";

export const dynamic = "force-dynamic";

/** The captions as WebVTT, for the player's <track>. */
export const GET = route(async (me, _req, { params }: Params<"id">) => {
  const v = await mediaFor(me, (await params).id);
  if (!v.captions) throw new UserError("This video has no captions", 404);
  return vttResponse(v.captions);
});

/** The owner uploads a WebVTT or SubRip file as the raw body. */
export const PUT = route(async (me, req, { params }: Params<"id">) => {
  const raw = await req.text();
  if (raw.length > MAX_CAPTIONS) throw new UserError("That captions file is too big", 413);
  return { video: await setCaptions(me, (await params).id, raw) };
});

export const DELETE = route(async (me, _req, { params }: Params<"id">) => ({ video: await clearCaptions(me, (await params).id) }));
