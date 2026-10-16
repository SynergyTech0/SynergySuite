import { route } from "@/lib/api";
import { categories } from "@/lib/catalog";

export const GET = route(async () => categories());
