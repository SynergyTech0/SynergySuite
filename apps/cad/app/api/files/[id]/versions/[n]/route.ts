import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/session";
import { getFile, readVersion, restoreVersion } from "@/lib/store";
import { versionName } from "@/lib/versions";

type Ctx = { params: Promise<{ id: string; n: string }> };

/** Downloads version `n` of the file, named after it ("plan (version 3).dxf"). */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id, n } = await params;
  const file = await getFile(me.subject, id);
  const bytes = file && (await readVersion(me.subject, id, Number(n)));
  if (!file || !bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(versionName(file.name, Number(n)))}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache",
    },
  });
}

/** Restores version `n`: it becomes the file's current bytes, and what it replaces is kept as a version. */
export async function POST(_req: NextRequest, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id, n } = await params;
  const file = await restoreVersion(me.subject, id, Number(n));
  return file ? NextResponse.json({ file }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
