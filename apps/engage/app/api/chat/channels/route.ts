import { route } from "@/lib/api";
import { chatChannels } from "@/lib/suite";

/** The viewer's Chat channels, for sharing a post or linking a community. */
export const GET = route(async (me) => chatChannels(me));
