import { body, vroute } from "@/lib/api";
import { createEmployee, listEmployees } from "@/lib/hr";

export const GET = vroute(async (v, req) => listEmployees(v, new URL(req.url).searchParams.get("former") === "1"));
export const POST = vroute(async (v, req) => createEmployee(v, await body(req)));
