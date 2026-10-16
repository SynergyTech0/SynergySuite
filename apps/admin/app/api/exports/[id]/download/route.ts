import fs from "node:fs";
import { Readable } from "node:stream";
import { route, type Params } from "@/lib/api";
import { record } from "@/lib/audit";
import { exportFile } from "@/lib/exports";

export const GET = route("compliance", async (me, _req, { params }: Params<"id">) => {
  const f = await exportFile(me, (await params).id);
  await record(me.email, "export.download", f.record.id, { matter: f.record.matterId, file: f.name, size: f.size, sha256: f.record.sha256 });
  return new Response(Readable.toWeb(fs.createReadStream(f.path)) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(f.size),
      "Content-Disposition": `attachment; filename="${f.name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
