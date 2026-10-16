import { body, idOf, route, type Params } from "@/lib/api";
import { copyBom } from "@/lib/mfg";

/** A new draft version from this bill. */
export const POST = route(async (me, _req, { params }: Params<"id">) => copyBom(idOf((await params).id), me.email));
