import { svcRoute } from "@/lib/api";
import { svcLocations } from "@/lib/svc";

export const dynamic = "force-dynamic";

export const GET = svcRoute(() => svcLocations());
