import { route } from "@/lib/api";
import { overview } from "@/lib/overview";

export const GET = route(async () => overview());
