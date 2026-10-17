import { route } from "@/lib/api";
import { dashboard } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export const GET = route(async () => dashboard());
