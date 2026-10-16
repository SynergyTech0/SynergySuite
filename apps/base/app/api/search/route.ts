import { SearchInputError } from "@synergy/search";
import { HttpError, route } from "@/lib/http";
import { searchBase } from "@/lib/search";

export const dynamic = "force-dynamic";

/** POST SearchQuery → SearchResults for the signed-in person (the suite's Search app calls this). */
export const POST = route(async (req, me) => {
  const body = await req.json().catch(() => ({}));
  try {
    return await searchBase(me.email, body);
  } catch (e) {
    if (e instanceof SearchInputError) throw new HttpError(400, e.message);
    throw e;
  }
});
