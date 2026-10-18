import { route } from "@/lib/api";
import { aiAvailable } from "@/lib/ai";
import { EMPLOYMENT_TYPES, STAGES, isRecruiter } from "@/lib/hire";

export const GET = route(async (me) => ({
  email: me.email,
  name: me.name,
  recruiter: isRecruiter(me.email),
  ai: await aiAvailable(),
  stages: STAGES,
  employmentTypes: EMPLOYMENT_TYPES,
  careersUrl: "/careers",
}));
