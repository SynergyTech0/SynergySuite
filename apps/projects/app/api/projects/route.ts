import { body, route } from "@/lib/api";
import { isDay } from "@/lib/dates";
import { createProject, listProjects } from "@/lib/projects";
import { UserError } from "@/lib/util";

export const GET = route(async (me, req) => {
  const today = new URL(req.url).searchParams.get("today") ?? new Date().toISOString().slice(0, 10);
  if (!isDay(today)) throw new UserError("Bad date");
  return listProjects(me.email, today);
});

export const POST = route(async (me, req) => createProject(me.email, await body(req)));
