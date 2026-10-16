import { handleSearch } from "@/lib/search";

export const dynamic = "force-dynamic";

/** POST SearchQuery → SearchResults for the signed-in person (the suite's Search app calls this). */
export const POST = (req: Request) => handleSearch(req);
