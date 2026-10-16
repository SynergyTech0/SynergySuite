import { type Params, route } from "@/lib/api";
import { isDay } from "@/lib/dates";
import { projectReport } from "@/lib/reports";
import { UserError } from "@/lib/util";

export const GET = route(async (me, req, { params }: Params<"id">) => {
  const today = new URL(req.url).searchParams.get("today") ?? new Date().toISOString().slice(0, 10);
  if (!isDay(today)) throw new UserError("Bad date");
  return projectReport(me.email, (await params).id, today);
});
