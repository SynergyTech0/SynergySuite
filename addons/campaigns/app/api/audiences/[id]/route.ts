import { body, route, type Params } from "@/lib/api";
import { audienceFields, audienceTags, deleteAudience, getAudience, updateAudience } from "@/lib/audiences";
import { publicBase } from "@/lib/render";
import { listSegments } from "@/lib/segments";
import { listSources } from "@/lib/sources";

export const dynamic = "force-dynamic";

/** The audience with what its screens need: tags, custom fields, segments, synced sources, form link. */
export const GET = route(async (_ctx, _req, { params }: Params<"id">) => {
  const a = await getAudience((await params).id);
  return {
    audience: a,
    tags: await audienceTags(a.id),
    fields: await audienceFields(a.id),
    segments: await listSegments(a.id),
    sources: await listSources(a.id),
    formUrl: `${publicBase()}/f/${a.id}`,
  };
});
export const PATCH = route(async (ctx, req, { params }: Params<"id">) => updateAudience(ctx, (await params).id, await body(req)));
export const DELETE = route(async (ctx, _req, { params }: Params<"id">) => deleteAudience(ctx, (await params).id));
