import { body, idOf, route, type Params } from "@/lib/api";
import { costing, listBoms } from "@/lib/mfg";
import { deleteItem, getItem, listMoves, updateItem } from "@/lib/stock";

export const GET = route(async (_me, _req, { params }: Params<"id">) => {
  const id = idOf((await params).id);
  const item = await getItem(id);
  const [moves, boms, cost] = await Promise.all([listMoves({ itemId: id, limit: 50 }), listBoms({ itemId: id }), costing(id)]);
  return { item, moves, boms, cost };
});

export const PATCH = route(async (_me, req, { params }: Params<"id">) => updateItem(idOf((await params).id), await body(req)));

export const DELETE = route(async (_me, _req, { params }: Params<"id">) => deleteItem(idOf((await params).id)));
