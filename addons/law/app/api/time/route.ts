import { route } from "@/lib/api";
import { myTime } from "@/lib/billing";
import { dayOrNull } from "@/lib/law";

/** The signed-in person's own time and expenses between two days (default: the last 14). */
export const GET = route(async (me, req) => {
  const s = new URL(req.url).searchParams;
  const to = dayOrNull(s.get("to"), "To") ?? new Date().toISOString().slice(0, 10);
  const from = dayOrNull(s.get("from"), "From") ?? new Date(Date.parse(to) - 13 * 86_400_000).toISOString().slice(0, 10);
  return myTime(me, from, to);
});
