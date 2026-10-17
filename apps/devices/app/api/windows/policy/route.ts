import { policies, soapRoute } from "@/lib/mdm/windows";

/** Windows enrollment policy (MS-XCEP): the key Windows makes for its identity certificate. */
export const POST = soapRoute(policies);
