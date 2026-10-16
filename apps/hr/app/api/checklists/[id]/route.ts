import { type Params, vroute } from "@/lib/api";
import { deleteChecklist } from "@/lib/hr";

export const DELETE = vroute(async (v, _req, { params }: Params<"id">) => deleteChecklist(v, (await params).id));
