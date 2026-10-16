import { type Params, route } from "@/lib/api";
import { plannerLinks, syncFromPlanner } from "@/lib/planner";

export const GET = route(async (me, _req, { params }: Params<"id">) => plannerLinks(me.email, (await params).id));

/** Brings the linked board's cards in as tasks (again: updates the ones it made). */
export const POST = route(async (me, _req, { params }: Params<"id">) => syncFromPlanner(me, (await params).id));
