import { adminRoute } from "@/lib/api";
import { finishSignup } from "@/lib/mdm/android";
import { organization } from "@/lib/mdm/apple";

/** Google sends the admin here after the sign-up, with ?enterpriseToken=. Admins. */
export const GET = adminRoute(async (me, req) => {
  const url = new URL(req.url);
  await finishSignup(me, url.searchParams.get("enterpriseToken") ?? "", organization());
  return new Response(null, { status: 303, headers: { location: "/#/android" } });
});
