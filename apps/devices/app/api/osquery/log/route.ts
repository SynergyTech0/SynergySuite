import { log, osqueryRoute } from "@/lib/osquery";

/** osquery results and status logs (--logger_tls_endpoint). */
export const POST = osqueryRoute(async (d, b) => {
  await log(d, b);
  return {};
});
