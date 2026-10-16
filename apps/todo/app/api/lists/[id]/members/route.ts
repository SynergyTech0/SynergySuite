import { body, route, type Params } from "@/lib/api";
import { share, unshare } from "@/lib/todo";

export const POST = route(async (me, req, { params }: Params<"id">) => {
  await share(me.email, (await params).id, (await body<{ email?: string }>(req)).email);
});

/** ?email= removes someone; your own address leaves the list. */
export const DELETE = route(async (me, req, { params }: Params<"id">) => {
  await unshare(me.email, (await params).id, new URL(req.url).searchParams.get("email"));
});
