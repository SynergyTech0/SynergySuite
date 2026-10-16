import { type Params, body, route } from "@/lib/api";
import { members, share, unshare } from "@/lib/diagrams";

export const GET = route(async (me, _req, { params }: Params<"id">) => members(me.email, (await params).id));

/** `{ email, role: "edit" | "view" }`: share, or change what someone can do. */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const b = await body<{ email?: string; role?: string }>(req);
  return { members: await share(me.email, (await params).id, b.email, b.role ?? "edit") };
});

export const DELETE = route(async (me, req, { params }: Params<"id">) => ({
  members: await unshare(me.email, (await params).id, new URL(req.url).searchParams.get("email")),
}));
