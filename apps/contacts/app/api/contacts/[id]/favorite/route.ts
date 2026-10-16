import { body, route, type Params } from "@/lib/api";
import { setFavorite } from "@/lib/contacts";

export const POST = route(async (me, req, { params }: Params<"id">) => {
  const b = await body<{ favorite?: boolean }>(req);
  await setFavorite(me.email, (await params).id, b.favorite === true);
});
