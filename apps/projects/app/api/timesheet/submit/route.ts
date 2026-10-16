import { body, route } from "@/lib/api";
import { recallWeek, submitWeek } from "@/lib/time";

/** { day, recall? }: sends the week holding `day` for approval, or takes it back. */
export const POST = route(async (me, req) => {
  const b = await body<{ day?: string; recall?: boolean }>(req);
  return { changed: b.recall ? await recallWeek(me.email, String(b.day ?? "")) : await submitWeek(me.email, String(b.day ?? "")) };
});
