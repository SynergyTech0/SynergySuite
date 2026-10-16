import { adminRoute } from "@/lib/api";
import { overview } from "@/lib/devices";

export const GET = adminRoute(async () => overview());
