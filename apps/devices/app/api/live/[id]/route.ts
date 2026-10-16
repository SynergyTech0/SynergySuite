import { adminRoute, type Params } from "@/lib/api";
import { getLive } from "@/lib/devices";

export const GET = adminRoute(async (_me, _req, { params }: Params<"id">) => getLive((await params).id));
