import { managementRoute } from "@/lib/mdm/windows";

/**
 * Windows check-ins (OMA-DM). The proxy serves this as https://devices-windows.<domain>/ManagementServer/MDM.svc,
 * asks the PC for its certificate and passes it in X-Client-Cert; on Devices' own host that header is stripped.
 */
export const POST = managementRoute;
