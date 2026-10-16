import { readSearchQuery, SearchInputError, matchesQuery, snippet, clipText, type SearchResult } from "@synergy/search";
import { body, route, studioLink } from "@/lib/api";
import { existingSession, listFlows } from "@/lib/engine";
import { UserError } from "@/lib/util";

export const dynamic = "force-dynamic";

/** Suite search over the person's flows by name and trigger. Someone who never opened Flow has none. */
export const POST = route(async (me, req) => {
  let q;
  try {
    q = readSearchQuery(await body(req));
  } catch (err) {
    if (err instanceof SearchInputError) throw new UserError(err.message, 400);
    throw err;
  }
  if (q.kinds.length && !q.kinds.includes("flow")) return { app: "flow", results: [] };
  const s = await existingSession(me);
  if (!s) return { app: "flow", results: [] };
  const results: SearchResult[] = [];
  for (const f of await listFlows(s)) {
    const hay = `${f.name} ${f.trigger}`;
    if (!matchesQuery(hay, q.parsed)) continue;
    const r: SearchResult = {
      id: f.id,
      kind: "flow",
      title: f.name,
      snippet: snippet(`${f.enabled ? "On" : "Off"} · ${f.trigger}`, q.parsed),
      date: f.updated,
      url: studioLink(`/projects/${s.projectId}/flows/${f.id}`),
    };
    if (q.text) r.text = clipText(hay);
    results.push(r);
    if (results.length >= q.limit) break;
  }
  return { app: "flow", results };
});
