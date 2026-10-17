import { adminRoute } from "@/lib/api";
import { syncAndroidDevices, syncAndroidPolicies } from "@/lib/mdm/android";

/** Pushes the Android policies again and reads every phone back from Google now. Admins. */
export const POST = adminRoute(async (me) => {
  await syncAndroidPolicies(me.email);
  return { devices: await syncAndroidDevices() };
});
