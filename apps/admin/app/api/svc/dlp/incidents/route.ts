import { body, serviceRoute } from "@/lib/api";
import { addIncident } from "@/lib/protection";

// Apps report DLP matches here (PolicyClient.reportDlp) over the internal network, with
// Bearer COMPLIANCE_TOKEN. The gateway does not route /api/svc/ publicly.
export const dynamic = "force-dynamic";
export const POST = serviceRoute(async (req) => addIncident(await body(req)));
