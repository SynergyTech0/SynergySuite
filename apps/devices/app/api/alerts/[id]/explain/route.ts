import { explainAlert } from "@/lib/ai";
import { adminRoute, type Params } from "@/lib/api";

/** A plain-language read of the alert from the suite's AI model. */
export const POST = adminRoute(async (_me, _req, { params }: Params<"id">) => ({ text: await explainAlert((await params).id) }));
