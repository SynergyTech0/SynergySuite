import { adminRoute } from "@/lib/api";
import { auditLog } from "@/lib/devices";

export const GET = adminRoute(async () => auditLog());
