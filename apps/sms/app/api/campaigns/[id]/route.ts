import { route, type Params } from "@/lib/api";
import { getCampaign } from "@/lib/sms";

export const GET = route(async (_me, _req, { params }: Params<"id">) => getCampaign((await params).id));
