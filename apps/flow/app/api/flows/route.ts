import { body, route, studioLink } from "@/lib/api";
import { createFlow, importFlow, listFlows, listRuns, personSession, pieceMeta } from "@/lib/engine";
import { recipeById, RECIPE_SCHEMA_VERSION } from "@/lib/recipes";
import { text, UserError } from "@/lib/util";

export const dynamic = "force-dynamic";

/** The person's flows and recent runs. */
export const GET = route(async (me) => {
  const s = await personSession(me);
  const [flows, runs] = await Promise.all([listFlows(s), listRuns(s, { limit: 20 })]);
  const names = new Map(flows.map((f) => [f.id, f.name]));
  return {
    projectId: s.projectId,
    flows: flows.map((f) => ({ ...f, link: studioLink(`/projects/${s.projectId}/flows/${f.id}`) })),
    runs: runs.map((r) => ({ ...r, flowName: r.flowName || names.get(r.flowId) || "Deleted flow", link: studioLink(`/projects/${s.projectId}/runs/${r.id}`) })),
  };
});

/** A new flow, empty or from a recipe; answers with the designer link to open. */
export const POST = route(async (me, req) => {
  const b = await body<{ name?: string; recipe?: string }>(req);
  const recipe = b.recipe ? recipeById(String(b.recipe)) : null;
  if (b.recipe && !recipe) throw new UserError("No such recipe");
  const name = text(b.name, 200) || recipe?.name || "Untitled flow";
  const s = await personSession(me);
  let flow = await createFlow(s, name);
  if (recipe) {
    const { version } = await pieceMeta();
    flow = await importFlow(s, flow.id, { displayName: name, trigger: recipe.build({ email: me.email, pieceVersion: version }), schemaVersion: RECIPE_SCHEMA_VERSION });
  }
  return { flow, link: studioLink(`/projects/${s.projectId}/flows/${flow.id}`) };
});
