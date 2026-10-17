import { route } from "@/lib/api";
import { aiAvailable } from "@/lib/ai";
import { linked, openUrls } from "@/lib/links";
import { partsLink } from "@/lib/parts";
import { getSettings, requireStaff } from "@/lib/staff";

/** What this install can do, for the screens: which apps are linked, AI steps, and the settings. */
export const GET = route(async (me) => {
  await requireStaff(me.email);
  return {
    ai: aiAvailable(),
    links: { books: linked("books"), commerce: linked("commerce"), desk: linked("desk"), ops: linked("ops") },
    urls: openUrls(),
    parts: await partsLink(),
    settings: await getSettings(),
  };
});
