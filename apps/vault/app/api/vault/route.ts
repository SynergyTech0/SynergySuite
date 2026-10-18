import { route } from "@/lib/api";
import { getVault } from "@/lib/vault";

export const GET = route(async () => getVault());
