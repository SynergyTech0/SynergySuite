import { body, route } from "@/lib/api";
import { cleanSearch, run } from "@/lib/search";

export const POST = route("compliance", async (me, req) => {
  const v = await body(req);
  let cursors: Record<string, string> | undefined;
  if (v.cursors && typeof v.cursors === "object" && !Array.isArray(v.cursors)) {
    cursors = Object.fromEntries(Object.entries(v.cursors as Record<string, unknown>).filter(([, c]) => typeof c === "string" && c).map(([a, c]) => [a, String(c).slice(0, 2000)]));
  }
  return run(me, cleanSearch(v), cursors);
});
