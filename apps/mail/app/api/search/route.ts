import { SearchInputError, readSearchQuery } from "@synergy/search";
import { UserError } from "@/lib/accounts";
import { route } from "@/lib/api";
import { personalSearch } from "@/lib/search";

export const dynamic = "force-dynamic";

/** Suite search for the signed-in person (gateway sign-in, like every other Mail route): their own mail only. */
export const POST = route(async (ctx, req) => {
  const body = await req.json().catch(() => null);
  let q;
  try {
    q = readSearchQuery(body);
  } catch (err) {
    if (err instanceof SearchInputError) throw new UserError(err.message, 400);
    throw err;
  }
  return personalSearch(ctx.user, ctx.name, q);
});
