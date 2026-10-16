import { route } from "@/lib/api";
import { importFromBooks } from "@/lib/books";

/** Brings Books' inventory items over. */
export const POST = route(async () => importFromBooks());
