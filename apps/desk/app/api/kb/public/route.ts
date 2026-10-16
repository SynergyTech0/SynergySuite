import { publicRoute } from "@/lib/api";
import { published } from "@/lib/kb";

export const dynamic = "force-dynamic";

// The published help-center articles, for anyone (no sign-in). Bodies are Markdown-lite source.
export const GET = publicRoute(async () =>
  (await published()).map((a) => ({ slug: a.slug, title: a.title, body: a.body, updated_at: a.updatedAt })));
