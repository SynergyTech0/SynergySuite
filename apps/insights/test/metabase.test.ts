import { describe, expect, it } from "vitest";
import { config } from "@/lib/config";
import { Metabase, type MetabaseUser } from "@/lib/metabase";

const c = config({ INSIGHTS_SECRET: "s3cret", SUITE_DOMAIN: "example.com", METABASE_INTERNAL_URL: "http://mb" });

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("ensureUser", () => {
  it("uses the account another request made at the same moment", async () => {
    const jane: MetabaseUser = { id: 2, email: "jane@example.com", first_name: "Jane", last_name: null, is_active: true, is_superuser: false };
    let lookups = 0;
    const fake = (async (url: string, init?: RequestInit) => {
      const path = url.replace("http://mb", "");
      if (path === "/api/session/properties") return json(200, { "has-user-setup": true });
      if (path === "/api/session") return json(200, { id: "svc" });
      if (path.startsWith("/api/user?")) return json(200, { data: lookups++ === 0 ? [] : [jane] });
      if (path === "/api/user" && init?.method === "POST") {
        return json(400, { message: 'ERROR: duplicate key value violates unique constraint "core_user_email_key"' });
      }
      throw new Error(`unexpected ${init?.method} ${path}`);
    }) as typeof fetch;
    const mb = new Metabase(c, fake);
    await expect(mb.ensureUser("jane@example.com", "Jane")).resolves.toEqual(jane);
  });

  it("still reports a failed create when no account turns up", async () => {
    const fake = (async (url: string, init?: RequestInit) => {
      const path = url.replace("http://mb", "");
      if (path === "/api/session/properties") return json(200, { "has-user-setup": true });
      if (path === "/api/session") return json(200, { id: "svc" });
      if (path.startsWith("/api/user?")) return json(200, { data: [] });
      if (path === "/api/user" && init?.method === "POST") return json(400, { message: "bad email" });
      throw new Error(`unexpected ${init?.method} ${path}`);
    }) as typeof fetch;
    await expect(new Metabase(c, fake).ensureUser("jane@example.com", "Jane")).rejects.toThrow(/bad email/);
  });
});
