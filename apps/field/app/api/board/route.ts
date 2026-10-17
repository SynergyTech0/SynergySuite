import { route } from "@/lib/api";
import { board } from "@/lib/schedule";

/** The dispatch board between two instants: ?from=ISO&to=ISO */
export const GET = route(async (me, req) => {
  const p = new URL(req.url).searchParams;
  return board(me.email, p.get("from"), p.get("to"));
});
