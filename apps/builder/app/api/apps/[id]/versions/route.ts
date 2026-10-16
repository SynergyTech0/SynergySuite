import { route } from "@/lib/http";
import { listVersions } from "@/lib/apps";

export const GET = route<{ id: string }>(async (_req, me, { id }) => ({ versions: await listVersions(id, me.email) }));
