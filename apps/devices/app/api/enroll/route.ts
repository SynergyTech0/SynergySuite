import { body, route } from "@/lib/api";
import { createSecret, listSecrets, serverHost } from "@/lib/enroll";
import { UserError } from "@/lib/util";

/** Your enrollment keys; admins also see the organization's (?all=1). */
export const GET = route(async (me, req) => {
  const all = me.role === "admin" && new URL(req.url).searchParams.get("all") === "1";
  return { host: serverHost(), keys: await listSecrets(all ? undefined : me.email) };
});

/** { name?, organization? } → the secret, once, with an install script per platform. */
export const POST = route(async (me, req) => {
  const b = await body<{ name?: unknown; organization?: unknown }>(req);
  if (b.organization && me.role !== "admin") throw new UserError("Only device admins can make organization keys", 403);
  return createSecret(me.email, { name: b.name, personal: !b.organization });
});
