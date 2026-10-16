import { SearchInputError } from "@synergy/search";
import { body, route } from "@/lib/api";
import { searchAll } from "@/lib/search";
import { UserError } from "@/lib/util";

/** Suite search, on behalf of the signed-in person (gateway headers, like every other route). */
export const POST = route(async (_ctx, req) => {
  try {
    return await searchAll(await body(req));
  } catch (err) {
    if (err instanceof SearchInputError) throw new UserError(err.message, 400);
    throw err;
  }
});
