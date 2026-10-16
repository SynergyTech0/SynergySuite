import { serviceRoute } from "@/lib/api";
import { currentPolicy } from "@/lib/policy";

// Read by every app (createPolicyClient) over the internal network. No signed-in person, no
// same-origin check: Bearer COMPLIANCE_TOKEN only. The gateway does not route /api/svc/ publicly.
export const dynamic = "force-dynamic";
export const GET = serviceRoute(async () => currentPolicy());
