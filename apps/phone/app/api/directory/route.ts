import { route } from "@/lib/api";
import { directory } from "@/lib/people";

export const dynamic = "force-dynamic";

type Suggestion = { name: string; email: string; source: string };

/**
 * People to call: everyone with Phone or a number, plus your Contacts and the organization
 * directory when the Contacts app is running (asked server to server, as you).
 */
export const GET = route(async (me, req) => {
  const search = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  const [local, contacts] = await Promise.all([directory(search, 20), search ? fromContacts(me, search) : Promise.resolve([])]);
  const seen = new Set(local.map((p) => p.email));
  const extra = contacts.filter((c) => !seen.has(c.email.toLowerCase())).map((c) => ({ email: c.email.toLowerCase(), name: c.name, number: null, numberLabel: "" }));
  return [...local, ...extra].filter((p) => p.email !== me.email.toLowerCase()).slice(0, 25);
});

async function fromContacts(me: { email: string; name: string }, search: string): Promise<Suggestion[]> {
  const base = process.env.CONTACTS_INTERNAL_URL || (process.env.NODE_ENV === "production" ? "http://contacts:3190" : "http://localhost:3190");
  const headers: Record<string, string> = { "x-auth-request-email": me.email, "x-auth-request-preferred-username": me.name };
  if (process.env.PROXY_SHARED_SECRET) headers["x-proxy-auth-secret"] = process.env.PROXY_SHARED_SECRET;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/suggest?${new URLSearchParams({ q: search, limit: "8" })}`, {
      headers, cache: "no-store", signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return [];
    const list = (await res.json()) as Suggestion[];
    return Array.isArray(list) ? list.filter((s) => s && typeof s.email === "string") : [];
  } catch {
    return [];
  }
}
