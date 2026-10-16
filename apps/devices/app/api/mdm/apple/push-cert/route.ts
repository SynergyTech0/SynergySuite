import { adminRoute, body } from "@/lib/api";
import { setPushCert } from "@/lib/mdm/apple";

/** { pem }: the APNs MDM push certificate followed by its unencrypted private key. Admins. */
export const PUT = adminRoute(async (me, req) => {
  const b = await body<{ pem?: unknown }>(req);
  return setPushCert(me, typeof b.pem === "string" ? b.pem : "");
});
