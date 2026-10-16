import { adminRoute, body } from "@/lib/api";
import { livekitConfig } from "@/lib/livekit";
import { type TrunkInput, createTrunk, listTrunks } from "@/lib/trunks";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async () => ({ trunks: await listTrunks(), mediaServer: Boolean(livekitConfig()) }));
export const POST = adminRoute(async (_me, req) => createTrunk(await body<TrunkInput>(req)));
