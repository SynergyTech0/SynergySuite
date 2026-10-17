import { currentUser } from "./api";
import { isAdmin, mailDomain, mayCreate } from "./groups";

/** The signed-in person as the screens need them, or null. */
export async function meInfo() {
  const me = await currentUser();
  if (!me) return null;
  return { email: me.email, name: me.name, admin: isAdmin(me.email), mayCreate: mayCreate(me.email), domain: mailDomain() };
}
