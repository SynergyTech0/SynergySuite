import { route } from "@/lib/api";
import { authPage } from "@/lib/mdm/windows";

/** The sign-in page Windows opens during enrollment (?appru=ms-app://…): hands the PC a one-time token for the person signed in. */
export const GET = route(async (me, req) => {
  const html = await authPage(me, new URL(req.url).searchParams.get("appru") ?? "");
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
});
