import { body, route } from "@/lib/api";
import { draftFromSuggestions } from "@/lib/purchasing";
import { reorderSuggestions } from "@/lib/stock";

export const GET = route(async () => reorderSuggestions());
/** Drafts purchase orders, one per vendor, for the ticked products. */
export const POST = route(async (ctx, req) => draftFromSuggestions(ctx, await body(req)));
