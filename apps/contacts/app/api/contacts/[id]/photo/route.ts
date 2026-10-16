import { route, type Params } from "@/lib/api";
import { photo, setPhoto } from "@/lib/contacts";
import { imageResponse, readBody } from "@/lib/serve";

export const GET = route(async (me, _req, { params }: Params<"id">) => imageResponse(await photo(me.email, (await params).id)));

export const PUT = route(async (me, req, { params }: Params<"id">) => {
  await setPhoto(me.email, (await params).id, await readBody(req, 2 * 1024 * 1024 + 1));
});

export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await setPhoto(me.email, (await params).id, null);
});
