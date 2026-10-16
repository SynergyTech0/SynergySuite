import { route } from "@/lib/api";
import { checkoutConfigured } from "@/lib/checkout";
import { booksConfigured } from "@/lib/books";
import { getSettings } from "@/lib/settings";

export const GET = route(async (ctx) => ({ ...ctx, settings: await getSettings(), books: booksConfigured(), checkout: checkoutConfigured() }));
