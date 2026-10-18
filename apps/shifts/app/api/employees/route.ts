import { body, route } from "@/lib/api";
import { isScheduler } from "@/lib/access";
import { createEmployee, listEmployees } from "@/lib/shifts";

export const GET = route(async (me, req) => listEmployees(isScheduler(me.email) && new URL(req.url).searchParams.has("all")));
export const POST = route(async (me, req) => createEmployee(me, await body(req)));
