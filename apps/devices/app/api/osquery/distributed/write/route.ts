import { distributedWrite, osqueryRoute } from "@/lib/osquery";

/** Answers to live queries (--distributed_tls_write_endpoint). */
export const POST = osqueryRoute(async (d, b) => {
  await distributedWrite(d, b);
  return {};
});
