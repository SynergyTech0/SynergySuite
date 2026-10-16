import { route } from "@/lib/api";
import { touch } from "@/lib/directory";

export const GET = route(async (me) => {
  await touch(me.email, me.name);
  return { email: me.email, name: me.name };
});
