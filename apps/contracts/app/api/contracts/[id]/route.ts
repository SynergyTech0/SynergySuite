import { body, route, type Params } from "@/lib/api";
import { deleteContract, getContract, updateContract } from "@/lib/contracts";

export const GET = route(async (me, _req, { params }: Params<"id">) => getContract(me, (await params).id));
export const PATCH = route(async (me, req, { params }: Params<"id">) => updateContract(me, (await params).id, await body(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => deleteContract(me, (await params).id));
