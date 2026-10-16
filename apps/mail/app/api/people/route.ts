import { route } from "@/lib/api";

export const dynamic = "force-dynamic";

type Suggestion = { name: string; email: string; source: "contact" | "directory" };

/**
 * Recipient suggestions for the To, Cc and Bcc boxes, from the person's Contacts and the
 * organization directory. Asked server to server, as the signed-in user; when Contacts isn't
 * running, the boxes simply don't suggest anything.
 */
export const GET = route(async ({ user, name }, req) => {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (!q) return [];
  const base = process.env.CONTACTS_INTERNAL_URL || (process.env.NODE_ENV === "production" ? "http://contacts:3190" : "http://localhost:3190");
  const headers: Record<string, string> = { "x-auth-request-email": user, "x-auth-request-preferred-username": name };
  if (process.env.PROXY_SHARED_SECRET) headers["x-proxy-auth-secret"] = process.env.PROXY_SHARED_SECRET;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/suggest?${new URLSearchParams({ q, limit: "8" })}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const list = (await res.json()) as Suggestion[];
    return Array.isArray(list) ? list.slice(0, 8) : [];
  } catch {
    return [];
  }
});
