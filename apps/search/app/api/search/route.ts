import { readSearchQuery, SearchInputError } from "@synergy/search";
import { body, route } from "@/lib/api";
import { fanOut, SEARCHABLE } from "@/lib/fanout";
import { queryTerms, rank } from "@/lib/rank";
import { UserError } from "@/lib/util";

export const dynamic = "force-dynamic";

/** POST { query, apps? } → every app's results for the signed-in person, ranked, plus how each app answered. */
export const POST = route(async (me, req) => {
  const b = await body(req);
  let q: ReturnType<typeof readSearchQuery>;
  try {
    q = readSearchQuery({ query: b.query, limit: 25 });
  } catch (e) {
    if (e instanceof SearchInputError) throw new UserError(e.message);
    throw e;
  }
  const only = Array.isArray(b.apps) ? b.apps.filter((a): a is string => typeof a === "string") : undefined;
  const { hits, apps } = await fanOut(me, { query: q.query, limit: q.limit }, { apps: only });
  const ranked = rank(hits, queryTerms(q.query), Date.now(), SEARCHABLE).map(({ text: _text, ...h }) => h);
  return { query: q.query, results: ranked, apps };
});
