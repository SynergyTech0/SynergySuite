import { route } from "@/lib/api";
import { myVisits } from "@/lib/schedule";

/** The signed-in technician's visits between two instants: ?from=ISO&to=ISO */
export const GET = route(async (me, req) => {
  const p = new URL(req.url).searchParams;
  return myVisits(me.email, p.get("from"), p.get("to"));
});
