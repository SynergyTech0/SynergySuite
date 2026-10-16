import { route } from "@/lib/api";
import { MAX_PROJECT, createProject, listProjects } from "@/lib/projects";
import { UserError } from "@/lib/util";

export const dynamic = "force-dynamic";

export const GET = route(async (me) => ({ projects: await listProjects(me) }));

/** POST ?name=<name>&videos=<id,id> with the .fcproj file as the raw body. */
export const POST = route(async (me, req) => {
  const url = new URL(req.url);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_PROJECT) throw new UserError("That project is too big", 413);
  const bytes = new Uint8Array(await req.arrayBuffer());
  const project = await createProject(me, url.searchParams.get("name"), bytes, (url.searchParams.get("videos") ?? "").split(","));
  return Response.json({ project }, { status: 201 });
});
