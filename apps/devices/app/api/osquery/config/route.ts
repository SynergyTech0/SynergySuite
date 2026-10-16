import { configFor, osqueryRoute } from "@/lib/osquery";

/** osquery configuration (--config_tls_endpoint): the schedule for this device's platform. */
export const POST = osqueryRoute(async (d) => configFor(d));
