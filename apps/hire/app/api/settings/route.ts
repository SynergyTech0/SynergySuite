import { body, route } from "@/lib/api";
import { careersSettings, saveCareersSettings } from "@/lib/hire";

export const GET = route(async () => careersSettings());
export const PUT = route(async (me, req) => saveCareersSettings(me, await body(req)));
