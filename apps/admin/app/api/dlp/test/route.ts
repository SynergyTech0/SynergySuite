import { body, route } from "@/lib/api";
import { testDlp } from "@/lib/protection";

export const POST = route("protection", async (_me, req) => testDlp(await body(req)));
