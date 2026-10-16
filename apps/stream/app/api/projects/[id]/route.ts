import { type Params, route } from "@/lib/api";
import { MAX_PROJECT, deleteProject, getProject, replaceProject } from "@/lib/projects";
import { UserError } from "@/lib/util";

export const dynamic = "force-dynamic";

export const GET = route(async (me, _req, { params }: Params<"id">) => ({ project: await getProject(me, (await params).id) }));

/** PUT ?videos=<id,id> with the saved .fcproj as the raw body replaces the project. */
export const PUT = route(async (me, req, { params }: Params<"id">) => {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_PROJECT) throw new UserError("That project is too big", 413);
  const bytes = new Uint8Array(await req.arrayBuffer());
  const videos = (new URL(req.url).searchParams.get("videos") ?? "").split(",");
  return { project: await replaceProject(me, (await params).id, bytes, videos) };
});

export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteProject(me, (await params).id);
  return { ok: true };
});
