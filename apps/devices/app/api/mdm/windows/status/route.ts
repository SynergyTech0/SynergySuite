import { route } from "@/lib/api";
import { enrollmentLink, windowsStatus } from "@/lib/mdm/windows";

/** Admins: Windows management's addresses and counts. Everyone: whether they can enroll, and their enrollment link. */
export const GET = route(async (me) => {
  const s = await windowsStatus();
  const mine = { ready: s.ready, link: enrollmentLink(me.email), server: s.discovery };
  return me.role === "admin" ? { ...s, ...mine } : mine;
});
