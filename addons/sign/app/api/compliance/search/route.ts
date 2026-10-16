import { complianceRoute, parseSearch } from "@/lib/compliance";
import { KINDS, search } from "@/lib/ediscovery";

export const dynamic = "force-dynamic";

/** eDiscovery search from the Admin center (Bearer COMPLIANCE_TOKEN). */
export const POST = complianceRoute(async (body) => search(parseSearch(body, KINDS)));
