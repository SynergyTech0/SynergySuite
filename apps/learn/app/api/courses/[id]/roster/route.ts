import { type Params, route } from "@/lib/api";
import { roster } from "@/lib/learn";

export const GET = route(async (me, _req, { params }: Params<"id">) => roster(me, (await params).id));
