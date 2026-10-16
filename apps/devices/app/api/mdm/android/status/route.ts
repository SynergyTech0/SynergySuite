import { route } from "@/lib/api";
import { androidStatus } from "@/lib/mdm/android";

/** Admins: whether Android management is connected and how many phones it manages. Others: whether they can enroll. */
export const GET = route(async (me) => {
  const s = await androidStatus();
  return me.role === "admin" ? s : { ready: s.ready };
});
