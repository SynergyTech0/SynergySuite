import { route } from "@/lib/api";
import { appleStatus } from "@/lib/mdm/apple";

/** Admins: whether Apple device management is set up, the push certificate and enrollment counts. Others: whether they can enroll. */
export const GET = route(async (me) => {
  const s = await appleStatus();
  return me.role === "admin" ? s : { ready: s.ready };
});
