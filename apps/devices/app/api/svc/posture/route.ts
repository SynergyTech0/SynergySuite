import { posture, svcAuthorized } from "@/lib/svc";

/** Fleet posture for Trust's evidence collectors (Bearer DEVICES_SVC_TOKEN). ?active_days=30 */
export async function GET(req: Request): Promise<Response> {
  if (!svcAuthorized(req.headers.get("authorization"))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const days = Number(new URL(req.url).searchParams.get("active_days") ?? 30);
    return Response.json(await posture(days), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[devices] posture", err);
    return Response.json({ error: "Something went wrong" }, { status: 500 });
  }
}
