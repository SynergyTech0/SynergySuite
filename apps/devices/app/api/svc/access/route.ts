import { access, svcAuthorized } from "@/lib/svc";

/** A person's devices and their compliance, for Auth's sign-in check (Bearer DEVICES_SVC_TOKEN). ?email= */
export async function GET(req: Request): Promise<Response> {
  if (!svcAuthorized(req.headers.get("authorization"))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const email = new URL(req.url).searchParams.get("email") ?? "";
  if (!email.includes("@")) return Response.json({ error: "Enter an email address" }, { status: 400 });
  try {
    return Response.json(await access(email), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[devices] access", err);
    return Response.json({ error: "Something went wrong" }, { status: 500 });
  }
}
