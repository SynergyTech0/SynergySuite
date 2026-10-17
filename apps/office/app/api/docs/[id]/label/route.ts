import { NextRequest, NextResponse } from "next/server";
import { labelById } from "@synergy/compliance";
import { q } from "@/lib/db";
import { identity } from "@/lib/identity";
import { docAccess, atLeast } from "@/lib/access";
import { knownLabel } from "@/lib/labels";
import { policy } from "@/lib/policy";

export const dynamic = "force-dynamic";

type Body = { labelId?: unknown; fromFile?: { id?: unknown; name?: unknown }; clearIfUnknown?: unknown };

// The document's sensitivity label; editors and owners may change it.
//   { labelId: "<id>" | null }   choose one of the organization's labels, or none
//   { fromFile: { id, name } }   the label an opened file carries: the matching label of ours; when
//                                it's another organization's label the document keeps its label,
//                                or has none with clearIfUnknown (where the file's own properties
//                                keep that label, as Docs and Sheets do)
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const a = await docAccess(id, me);
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!atLeast(a.role, "editor")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const settings = await policy().labels();
  let labelId: string | null;
  if (body.fromFile && typeof body.fromFile === "object" && typeof body.fromFile.id === "string") {
    const known = knownLabel(settings, { id: body.fromFile.id, name: typeof body.fromFile.name === "string" ? body.fromFile.name : "" });
    if (!known && body.clearIfUnknown !== true) return NextResponse.json({ labelId: a.doc.label_id });
    labelId = known?.id ?? null;
  } else if (body.labelId === null) {
    labelId = null;
  } else if (typeof body.labelId === "string") {
    const l = labelById(settings, body.labelId);
    if (!l) return NextResponse.json({ error: "That label isn't one of your organization's labels." }, { status: 400 });
    labelId = l.id;
  } else {
    return NextResponse.json({ error: "labelId or fromFile is required" }, { status: 400 });
  }
  await q(`UPDATE documents SET label_id = $3 WHERE id = $1 AND org = $2`, [id, me.org, labelId]);
  return NextResponse.json({ labelId });
}
