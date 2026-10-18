import { route, type Params } from "@/lib/api";
import { thread } from "@/lib/sms";

export const GET = route(async (_me, _req, { params }: Params<"phone">) => thread(decodeURIComponent((await params).phone)));
