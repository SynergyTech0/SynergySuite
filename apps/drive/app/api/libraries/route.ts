import { body, route } from "@/lib/api";
import * as drive from "@/lib/drive";

/** Shared libraries (SharePoint document libraries / shared drives) I belong to. */
export const GET = route(async (me) => ({ libraries: await drive.libraries(me) }));

export const POST = route(async (me, req) => {
  const b = await body<{ name?: string; description?: string }>(req);
  return drive.createLibrary(me, b.name ?? "", b.description ?? "");
});
