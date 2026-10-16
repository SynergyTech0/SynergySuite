import { route, type Params } from "@/lib/api";
import { profilePhoto } from "@/lib/directory";
import { imageResponse } from "@/lib/serve";

export const GET = route(async (_me, _req, { params }: Params<"email">) => imageResponse(await profilePhoto(decodeURIComponent((await params).email))));
