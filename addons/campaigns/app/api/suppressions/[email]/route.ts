import { route, type Params } from "@/lib/api";
import { removeSuppression } from "@/lib/audiences";

export const DELETE = route(async (ctx, _req, { params }: Params<"email">) => removeSuppression(ctx, decodeURIComponent((await params).email)));
