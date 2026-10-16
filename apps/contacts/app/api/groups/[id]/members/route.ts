import { body, route, type Params } from "@/lib/api";
import { setMembership } from "@/lib/contacts";

export const POST = route(async (me, req, { params }: Params<"id">) => {
  const b = await body<{ ids?: string[]; member?: boolean }>(req);
  await setMembership(me.email, (await params).id, Array.isArray(b.ids) ? b.ids.map(String) : [], b.member !== false);
});
