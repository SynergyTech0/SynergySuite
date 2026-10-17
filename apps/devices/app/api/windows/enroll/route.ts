import { enroll, soapRoute } from "@/lib/mdm/windows";

/** Windows enrollment (MS-WSTEP): signs the PC's certificate request and sends back how to check in. */
export const POST = soapRoute(enroll);
