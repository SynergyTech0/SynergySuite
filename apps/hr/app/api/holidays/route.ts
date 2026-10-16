import { body, vroute } from "@/lib/api";
import { listHolidays, setHoliday } from "@/lib/hr";

export const GET = vroute(async (_v, req) => {
  const y = Number(new URL(req.url).searchParams.get("year")) || new Date().getUTCFullYear();
  return listHolidays(y);
});
export const POST = vroute(async (v, req) => setHoliday(v, await body(req)));
