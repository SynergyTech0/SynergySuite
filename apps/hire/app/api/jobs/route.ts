import { body, route } from "@/lib/api";
import { listJobs, saveJob } from "@/lib/hire";

export const GET = route(async (me) => listJobs(me));
export const POST = route(async (me, req) => saveJob(me, null, await body(req)));
