import { adminRoute } from "@/lib/api";
import { startSignup } from "@/lib/mdm/android";

/** Starts connecting a managed Google Play enterprise; the admin finishes at the returned Google address. Admins. */
export const POST = adminRoute(async (me) => startSignup(me));
