import { route } from "@/lib/api";
import { setProfilePhoto } from "@/lib/directory";
import { readBody } from "@/lib/serve";

export const PUT = route(async (me, req) => {
  await setProfilePhoto(me.email, await readBody(req, 2 * 1024 * 1024 + 1));
});

export const DELETE = route(async (me) => {
  await setProfilePhoto(me.email, null);
});
