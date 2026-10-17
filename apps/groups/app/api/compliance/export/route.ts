import { complianceRoute, parseIds } from "@/lib/compliance";
import { exportItems } from "@/lib/ediscovery";

/** eDiscovery export from the Admin center (Bearer COMPLIANCE_TOKEN). */
export const POST = complianceRoute(async (body) => exportItems(parseIds(body)));
