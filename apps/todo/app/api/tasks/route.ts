import { body, route } from "@/lib/api";
import { createTask, tasks, type NewTask } from "@/lib/todo";
import type { SmartView } from "@/lib/types";

export const GET = route(async (me, req) => {
  const u = new URL(req.url).searchParams;
  return tasks(me.email, {
    view: (u.get("view") as SmartView) || undefined,
    list: u.get("list") || undefined,
    today: u.get("today") ?? "",
    q: u.get("q") ?? "",
  });
});

export const POST = route(async (me, req) => createTask(me.email, await body<NewTask>(req)));
