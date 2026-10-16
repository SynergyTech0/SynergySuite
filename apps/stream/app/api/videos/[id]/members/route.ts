import { type Params, body, route } from "@/lib/api";
import { addMember, removeMember } from "@/lib/videos";

/** { email }: share with one person, or stop sharing with them. */
export const POST = route(async (me, req, { params }: Params<"id">) => ({
  video: await addMember(me, (await params).id, (await body<{ email?: unknown }>(req)).email),
}));

export const DELETE = route(async (me, req, { params }: Params<"id">) => ({
  video: await removeMember(me, (await params).id, (await body<{ email?: unknown }>(req)).email),
}));
