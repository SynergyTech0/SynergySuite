import { type Params, body, route } from "@/lib/api";
import { moveLesson } from "@/lib/learn";

export const POST = route(async (me, req, { params }: Params<"id">) => {
  const { dir } = await body<{ dir?: string }>(req);
  return moveLesson(me, (await params).id, dir === "up" ? "up" : "down");
});
