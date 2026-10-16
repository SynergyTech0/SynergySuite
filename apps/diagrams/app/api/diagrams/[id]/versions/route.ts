import { type Params, route } from "@/lib/api";
import { versions } from "@/lib/diagrams";

export const GET = route(async (me, _req, { params }: Params<"id">) => ({ versions: await versions(me.email, (await params).id) }));
