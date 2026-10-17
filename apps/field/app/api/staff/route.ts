import { body, route } from "@/lib/api";
import { listStaff, removeStaff, requireStaff, saveStaff } from "@/lib/staff";

export const GET = route(async (me) => {
  await requireStaff(me.email);
  return listStaff();
});

/** Adds someone to the team or changes them (dispatchers). */
export const POST = route(async (me, req) => saveStaff(me.email, await body(req)));

/** Takes someone off the team: ?email= */
export const DELETE = route(async (me, req) => {
  await removeStaff(me.email, new URL(req.url).searchParams.get("email") ?? "");
});
