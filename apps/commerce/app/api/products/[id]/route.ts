import { body, route, type Params } from "@/lib/api";
import { deleteProduct, product, saveProduct } from "@/lib/catalog";

export const GET = route(async (_ctx, _req, { params }: Params<"id">) => product((await params).id));
export const PUT = route(async (ctx, req, { params }: Params<"id">) => saveProduct(ctx, (await params).id, await body(req)));
export const DELETE = route(async (ctx, _req, { params }: Params<"id">) => deleteProduct(ctx, (await params).id));
