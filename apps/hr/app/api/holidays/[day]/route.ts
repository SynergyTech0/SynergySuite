import { type Params, vroute } from "@/lib/api";
import { removeHoliday } from "@/lib/hr";

export const DELETE = vroute(async (v, _req, { params }: Params<"day">) => removeHoliday(v, (await params).day));
