import { vroute } from "@/lib/api";
import { taxForms } from "@/lib/payroll/yearend";

export const GET = vroute(async (v, req) => taxForms(v, new URL(req.url).searchParams.get("year")));
