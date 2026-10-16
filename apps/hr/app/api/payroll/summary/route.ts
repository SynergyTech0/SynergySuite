import { vroute } from "@/lib/api";
import { taxSummary } from "@/lib/payroll/runs";

export const GET = vroute(async (v, req) => taxSummary(v, Number(new URL(req.url).searchParams.get("year")) || new Date().getUTCFullYear()));
