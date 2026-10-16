import { route } from "@/lib/api";
import { list } from "@/lib/members";

export const GET = route(async () => list());
