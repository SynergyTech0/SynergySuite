import { type Params, route } from "@/lib/api";
import * as drive from "@/lib/drive";

export const GET = route(async (me, _req, { params }: Params<"id">) => ({ versions: await drive.versions(me, (await params).id) }));
