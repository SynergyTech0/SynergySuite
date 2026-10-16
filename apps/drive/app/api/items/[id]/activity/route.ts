import { type Params, route } from "@/lib/api";
import * as drive from "@/lib/drive";

export const GET = route(async (me, _req, { params }: Params<"id">) => ({ activity: await drive.activity(me, (await params).id) }));
