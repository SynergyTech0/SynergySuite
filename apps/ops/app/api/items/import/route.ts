import { route } from "@/lib/api";
import { importFromCommerce } from "@/lib/commerce";

/** Brings Commerce's products over. */
export const POST = route(async () => importFromCommerce());
