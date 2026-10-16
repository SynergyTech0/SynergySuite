import { body, route } from "@/lib/api";
import { viewItem } from "@/lib/search";
import { text } from "@/lib/util";

export const POST = route("compliance", async (me, req) => {
  const v = await body(req);
  return viewItem(me, text(v.app, 40), text(v.id, 1000));
});
