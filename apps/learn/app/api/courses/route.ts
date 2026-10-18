import { body, route } from "@/lib/api";
import { listCourses, saveCourse } from "@/lib/learn";

export const GET = route(async (me, req) => listCourses(me, new URL(req.url).searchParams.get("all") === "1"));
export const POST = route(async (me, req) => saveCourse(me, null, await body(req)));
