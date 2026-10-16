import { route } from "@/lib/api";
import { booksConfigured, booksInvoicesUrl } from "@/lib/books";
import { planAiAvailable } from "@/lib/plan-ai";

/** What this install can do, for the screens: AI plan drafts, billing into Books. */
export const GET = route(async () => ({ ai: planAiAvailable(), books: booksConfigured(), booksUrl: booksInvoicesUrl() }));
