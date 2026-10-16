import { vroute } from "@/lib/api";
import { myW2Years } from "@/lib/payroll/yearend";

export const GET = vroute(async (v) => myW2Years(v.email));
