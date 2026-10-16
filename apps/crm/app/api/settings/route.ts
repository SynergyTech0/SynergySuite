import { body, route } from "@/lib/api";
import * as access from "@/lib/access";

/** What reps can see: { repRead: "own" | "all" }. Anyone may read it; only admins change it. */
export const GET = route(async () => ({ repRead: await access.readScope() }));

export const PATCH = route(async (ctx, req) => ({ repRead: await access.setReadScope(ctx, (await body(req)).repRead) }));
