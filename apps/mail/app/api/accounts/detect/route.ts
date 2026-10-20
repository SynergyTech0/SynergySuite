import { route } from "@/lib/api";
import { detectProvider } from "@/lib/detect";
import { microsoftConfig } from "@/lib/oauth";

export const dynamic = "force-dynamic";

/** Add account asks, as the address is typed, how this mailbox signs in. */
export const GET = route(async (_ctx, req) => {
  const address = new URL(req.url).searchParams.get("address") ?? "";
  return { provider: await detectProvider(address), microsoft: Boolean(microsoftConfig()) };
});
