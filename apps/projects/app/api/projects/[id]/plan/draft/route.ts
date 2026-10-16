import { type Params, body, route } from "@/lib/api";
import { draftPlan } from "@/lib/plan-ai";

/** An AI draft of the plan, for the manager to look over before adding. */
export const POST = route(async (me, req, { params }: Params<"id">) => draftPlan(me.email, (await params).id, (await body<{ notes?: unknown }>(req)).notes));
