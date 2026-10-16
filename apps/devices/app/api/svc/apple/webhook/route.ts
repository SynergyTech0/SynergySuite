import { handleWebhook, type WebhookEvent } from "@/lib/mdm/apple";
import { webhookSigned } from "@/lib/mdm/nanomdm";

/**
 * NanoMDM's webhook: device check-ins and command results. Reached only on the compose network
 * (the proxy answers 404 for /api/svc/*), and every body must carry NanoMDM's HMAC signature.
 */
export async function POST(req: Request): Promise<Response> {
  const raw = Buffer.from(await req.arrayBuffer());
  if (!webhookSigned(raw, req.headers.get("x-hmac-signature"))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let ev: WebhookEvent;
  try {
    ev = JSON.parse(raw.toString("utf8")) as WebhookEvent;
  } catch {
    return Response.json({ error: "Bad request body" }, { status: 400 });
  }
  try {
    await handleWebhook(ev);
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[devices] mdm webhook", err);
    return Response.json({ error: "Something went wrong" }, { status: 500 });
  }
}
