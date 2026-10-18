import { SearchInputError } from "@synergy/search";
import { body, route } from "@/lib/api";
import { searchFor } from "@/lib/search";
import { UserError } from "@/lib/util";

/** Suite search, on behalf of the signed-in person (gateway headers, like every other route). */
export const POST = route(async (me, req) => {
  try {
    return await searchFor(me, await body(req));
  } catch (err) {
    if (err instanceof SearchInputError) throw new UserError(err.message, 400);
    throw err;
  }
});
