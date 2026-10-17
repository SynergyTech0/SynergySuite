import { type Params, body, route } from "@/lib/api";
import { type NewEvent, addEvent, events } from "@/lib/space";

/** The team calendar between ?from and ?to (default: today and the next four weeks). */
export const GET = route(async (me, req, { params }: Params<"id">) => {
  const sp = new URL(req.url).searchParams;
  const from = sp.get("from") ? new Date(sp.get("from")!) : new Date(new Date().setHours(0, 0, 0, 0));
  const to = sp.get("to") ? new Date(sp.get("to")!) : new Date(from.getTime() + 28 * 86_400_000);
  return events(me, (await params).id, Number.isNaN(from.getTime()) ? new Date() : from, Number.isNaN(to.getTime()) ? new Date(Date.now() + 28 * 86_400_000) : to);
});

/** A meeting on the team calendar: { title, startAt, endAt, allDay?, location?, description? }. */
export const POST = route(async (me, req, { params }: Params<"id">) => addEvent(me, (await params).id, await body<NewEvent>(req)));
