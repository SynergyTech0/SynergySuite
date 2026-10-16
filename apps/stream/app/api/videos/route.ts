import { route } from "@/lib/api";
import { resumeProcessing } from "@/lib/media";
import { type Shelf, createVideo, listVideos } from "@/lib/videos";

export const dynamic = "force-dynamic";

const SHELVES: Shelf[] = ["mine", "shared", "org"];

/** GET ?shelf=mine|shared|org&q=words: a shelf of the library. */
export const GET = route(async (me, req) => {
  await resumeProcessing();
  const url = new URL(req.url);
  const shelf = SHELVES.find((s) => s === url.searchParams.get("shelf")) ?? "mine";
  return { videos: await listVideos(me, shelf, url.searchParams.get("q") ?? "") };
});

/**
 * POST ?name=<file name>&origin=upload|recording|editor with the file as the raw body (streamed to
 * disk, so videos of any size up to STREAM_MAX_UPLOAD_MB work).
 */
export const POST = route(async (me, req) => {
  const url = new URL(req.url);
  const origin = url.searchParams.get("origin");
  const video = await createVideo(
    me,
    url.searchParams.get("name") ?? "",
    req.body,
    origin === "recording" || origin === "editor" ? origin : "upload",
  );
  return Response.json({ video }, { status: 201 });
});
