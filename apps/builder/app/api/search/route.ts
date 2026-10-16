import { SearchInputError } from "@synergy/search";
import { body, HttpError, route } from "@/lib/http";
import { searchFor } from "@/lib/search";

/** Suite search, on behalf of the signed-in person (gateway headers, like every other route). */
export const POST = route(async (req, me) => {
  try {
    return await searchFor(me.email, await body(req));
  } catch (err) {
    if (err instanceof SearchInputError) throw new HttpError(400, err.message);
    throw err;
  }
});
