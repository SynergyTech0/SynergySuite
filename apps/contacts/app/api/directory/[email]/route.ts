import { route, type Params } from "@/lib/api";
import { person } from "@/lib/directory";

export const GET = route(async (_me, _req, { params }: Params<"email">) => person(decodeURIComponent((await params).email)));
