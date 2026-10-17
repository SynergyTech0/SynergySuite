import { route } from "@/lib/api";
import { TYPES, STATUSES, canKeepLibrary, isAdmin } from "@/lib/contracts";
import { reviewAvailable } from "@/lib/review";
import { signingConfigured } from "@/lib/sign";

export const GET = route(async (me) => ({
  email: me.email,
  name: me.name,
  legal: isAdmin(me.email),
  library: canKeepLibrary(me.email),
  ai: await reviewAvailable(),
  signing: signingConfigured(),
  signApp: process.env.SUITE_DOMAIN ? `https://sign.${process.env.SUITE_DOMAIN}` : "",
  types: TYPES,
  statuses: STATUSES,
}));
