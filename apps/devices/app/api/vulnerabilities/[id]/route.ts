import { adminRoute, type Params } from "@/lib/api";
import { vulnDevices } from "@/lib/devices";

/** The devices one advisory affects. */
export const GET = adminRoute(async (_me, _req, { params }: Params<"id">) => vulnDevices(decodeURIComponent((await params).id)));
