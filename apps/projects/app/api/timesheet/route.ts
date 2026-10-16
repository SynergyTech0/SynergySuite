import { route } from "@/lib/api";
import { timesheet } from "@/lib/time";

/** The week (Monday to Sunday) holding ?day=YYYY-MM-DD. */
export const GET = route(async (me, req) => timesheet(me.email, new URL(req.url).searchParams.get("day") ?? ""));
