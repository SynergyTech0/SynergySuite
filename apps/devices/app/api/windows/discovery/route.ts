import { discover, soapRoute, windowsEnabled } from "@/lib/mdm/windows";

/** Windows enrollment discovery (MS-MDE2). Windows checks that a GET answers before it POSTs. */
export async function GET(): Promise<Response> {
  return new Response(null, { status: windowsEnabled() ? 200 : 404 });
}

export const POST = soapRoute(discover);
