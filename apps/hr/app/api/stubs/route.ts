import { vroute } from "@/lib/api";
import { myStubs } from "@/lib/payroll/runs";

export const GET = vroute(async (v) => myStubs(v.email));
