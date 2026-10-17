import { complianceRoute, parseIds } from "@/lib/compliance";
import { exportItems } from "@/lib/ediscovery";

export const dynamic = "force-dynamic";

/** eDiscovery export from the Admin center (Bearer COMPLIANCE_TOKEN): each document in full, with its PDFs and audit trail. */
export const POST = complianceRoute(async (body) => exportItems(parseIds(body)));
