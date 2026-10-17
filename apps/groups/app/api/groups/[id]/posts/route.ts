import { type Params, body, route } from "@/lib/api";
import { activity, post } from "@/lib/space";

/** The team's latest conversations across its channels, from Chat. */
export const GET = route(async (me, req, { params }: Params<"id">) => {
  const limit = Number(new URL(req.url).searchParams.get("limit")) || 20;
  return activity(me, (await params).id, limit);
});

/** Starts a conversation in a channel: { channelKey, body }. */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const b = await body<{ channelKey?: string; body?: string }>(req);
  return post(me, (await params).id, b.channelKey, b.body);
});
