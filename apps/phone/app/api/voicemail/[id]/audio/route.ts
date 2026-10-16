import { type Params, route } from "@/lib/api";
import { voicemailAudio } from "@/lib/history";

export const dynamic = "force-dynamic";

export const GET = route(async (me, _req, ctx: Params<"id">) => {
  const wav = await voicemailAudio(me.email, (await ctx.params).id);
  return new Response(new Uint8Array(wav), { headers: { "content-type": "audio/wav", "cache-control": "private, max-age=3600" } });
});
