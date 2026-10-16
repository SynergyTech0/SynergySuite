import { body, idOf, route, type Params } from "@/lib/api";
import { depreciation, getAsset, listOrders, listPlans, listReadings, updateAsset } from "@/lib/assets";

export const GET = route(async (_me, _req, { params }: Params<"id">) => {
  const id = idOf((await params).id);
  const asset = await getAsset(id);
  const [plans, orders, readings] = await Promise.all([listPlans({ assetId: id }), listOrders({ assetId: id }), listReadings(id)]);
  return { asset, plans, orders, readings, depreciation: depreciation(asset) };
});

export const PATCH = route(async (_me, req, { params }: Params<"id">) => updateAsset(idOf((await params).id), await body(req)));
