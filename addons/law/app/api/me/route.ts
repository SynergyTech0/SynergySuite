import { route } from "@/lib/api";
import { booksConfigured } from "@/lib/books";
import { PRESETS } from "@/lib/deadlines";
import { aiAvailable } from "@/lib/documents";
import { JURISDICTIONS } from "@/lib/jurisdictions";
import { FEE_TYPES, PARTY_ROLES, PRACTICE_AREAS, TEAM_ROLES, isAdmin, isTrustKeeper } from "@/lib/law";

/** Who is asking, what they may do, and the lists the screens offer. */
export const GET = route(async (me) => ({
  email: me.email,
  name: me.name,
  admin: isAdmin(me.email),
  trustKeeper: isTrustKeeper(me.email),
  ai: aiAvailable(),
  books: booksConfigured(),
  practiceAreas: PRACTICE_AREAS,
  feeTypes: FEE_TYPES,
  partyRoles: PARTY_ROLES,
  teamRoles: TEAM_ROLES,
  jurisdictions: JURISDICTIONS,
  presets: PRESETS,
}));
