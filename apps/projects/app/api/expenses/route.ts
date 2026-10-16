import { body, route } from "@/lib/api";
import { createExpense, myExpenses } from "@/lib/time";

export const GET = route(async (me) => myExpenses(me.email));

export const POST = route(async (me, req) => createExpense(me.email, await body(req)));
