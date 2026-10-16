import { type Params, route } from "@/lib/api";
import { getProject } from "@/lib/projects";
import { fileResponse } from "@/lib/serve";
import { projectFile } from "@/lib/store";

export const dynamic = "force-dynamic";

/** The project file, for the editor to open. */
export const GET = route(async (me, req, { params }: Params<"id">) => {
  const p = await getProject(me, (await params).id);
  return fileResponse(req, projectFile(p.id), { type: "application/octet-stream", name: p.name, cache: "private, no-cache" });
});
