import { OsqueryError, clientIp, enroll, readBody } from "@/lib/osquery";

/** osquery enrollment (--enroll_tls_endpoint): enroll secret in, node key out. Reached without a suite sign-in. */
export async function POST(req: Request): Promise<Response> {
  try {
    return Response.json(await enroll(await readBody(req), clientIp(req)));
  } catch (err) {
    if (err instanceof OsqueryError) return Response.json({ error: err.message }, { status: 400 });
    console.error("[devices] enroll", err);
    return Response.json({ error: "Something went wrong" }, { status: 500 });
  }
}
