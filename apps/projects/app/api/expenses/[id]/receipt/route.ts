import { type Params, route } from "@/lib/api";
import { MAX_RECEIPT, getReceipt, setReceipt } from "@/lib/time";
import { UserError } from "@/lib/util";

export const GET = route(async (me, _req, { params }: Params<"id">) => {
  const r = await getReceipt(me.email, (await params).id);
  if (!r) throw new UserError("No receipt", 404);
  // Shown inline only when it is a picture or a PDF, never as a page that could run scripts.
  return new Response(new Uint8Array(r.bytes), {
    headers: {
      "content-type": r.type,
      "content-disposition": `inline; filename="${r.name.replace(/[^\w.\- ]+/g, "_")}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
});

/** The file is the request body; its name is ?name= and its type the Content-Type header. */
export const PUT = route(async (me, req, { params }: Params<"id">) => {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_RECEIPT) throw new UserError("A receipt can be up to 10 MB");
  const bytes = Buffer.from(await req.arrayBuffer());
  if (!bytes.length) throw new UserError("The file is empty");
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  await setReceipt(me.email, (await params).id, { name: new URL(req.url).searchParams.get("name") ?? "receipt", type, bytes });
});

export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await setReceipt(me.email, (await params).id, null);
});
