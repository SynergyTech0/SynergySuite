import { route } from "@/lib/api";
import { facets } from "@/lib/accounts";

/** The industries and states to filter the account list by. */
export const GET = route(async (ctx) => facets(ctx));
