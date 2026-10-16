import { route } from "@/lib/api";
import { listPostings } from "@/lib/books";

export const GET = route(async (_ctx, req) => listPostings({ status: new URL(req.url).searchParams.get("status") ?? "" }));
