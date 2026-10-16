import { idOf, route, type Params } from "@/lib/api";
import { sendAsset } from "@/lib/books";

/** Sends the asset to Books' fixed-asset register (or updates it there). */
export const POST = route(async (_me, _req, { params }: Params<"id">) => sendAsset(idOf((await params).id)));
