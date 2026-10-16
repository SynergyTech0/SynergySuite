import { distributedRead, osqueryRoute } from "@/lib/osquery";

/** Live queries and "refresh now" waiting for this device (--distributed_tls_read_endpoint). */
export const POST = osqueryRoute(async (d) => distributedRead(d));
