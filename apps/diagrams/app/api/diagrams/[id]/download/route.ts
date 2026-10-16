import { type Params, route } from "@/lib/api";
import { get } from "@/lib/diagrams";

/** The diagram as a .drawio file (draw.io XML), which draw.io and Synergy Diagrams open. */
export const GET = route(async (me, _req, { params }: Params<"id">) => {
  const d = await get(me.email, (await params).id);
  const name = `${d.name.replace(/[\\/:*?"<>|]+/g, "_")}.drawio`;
  return new Response(d.xml, {
    headers: {
      "Content-Type": "application/vnd.jgraph.mxfile; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
});
