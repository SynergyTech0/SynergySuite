import { route } from "@/lib/api";
import { contactGroups } from "@/lib/sources";

export const dynamic = "force-dynamic";

export const GET = route(async (ctx) => contactGroups(ctx));
