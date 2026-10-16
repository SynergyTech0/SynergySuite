import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { existingSession, personSession, resetServiceSession } from "../lib/engine";
import { keyOwner } from "../lib/keys";

const env = {
  FLOW_SECRET: "a-test-secret-that-is-long",
  SUITE_DOMAIN: "suite.test",
  FLOW_ENGINE_URL: "http://engine",
  FLOW_INTERNAL_URL: "http://flow:3720",
  FLOW_PIECE_DIR: path.join(import.meta.dirname, "fixtures"),
} as unknown as NodeJS.ProcessEnv;
const ada = { email: "Ada@Example.com", subject: "sub-1", name: "Ada Lovelace" };

/** A tiny stand-in for the engine: accounts by email, installed pieces, saved connections. */
function engine() {
  const accounts = new Map<string, string>();
  const pieces: string[] = [];
  const connections: any[] = [];
  const log: string[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const p = url.replace("http://engine/api", "");
    const method = init.method ?? "GET";
    log.push(`${method} ${p.split("?")[0]}`);
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    const ok = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    const err = (status: number, code: string) => new Response(JSON.stringify({ code, message: code }), { status });
    if (p === "/v1/authentication/sign-in") {
      return accounts.get(body.email) === body.password ? ok({ token: `tok-${body.email}`, projectId: `proj-${body.email}`, id: `u-${body.email}` }) : err(401, "INVALID_CREDENTIALS");
    }
    if (p === "/v1/authentication/sign-up") {
      if (accounts.has(body.email)) return err(409, "EXISTING_USER");
      accounts.set(body.email, body.password);
      return ok({ token: `tok-${body.email}`, projectId: `proj-${body.email}`, id: `u-${body.email}` });
    }
    if (p.startsWith("/v1/pieces/")) return pieces.length ? ok({ version: "0.1.0" }) : err(404, "ENTITY_NOT_FOUND");
    if (p === "/v1/pieces" && method === "POST") {
      const form = init.body as FormData;
      pieces.push(`${form.get("pieceName")}@${form.get("pieceVersion")}`);
      return ok({});
    }
    if (p === "/v1/app-connections") {
      connections.push({ ...body, token: (init.headers as Record<string, string>).authorization });
      return ok({});
    }
    return err(404, "NOT_FOUND");
  }) as unknown as typeof fetch;
  return { f, accounts, pieces, connections, log };
}

describe("engine accounts", () => {
  beforeEach(() => resetServiceSession());

  it("claims the service account first, then creates the person, installs the piece and their connection", async () => {
    const e = engine();
    const s = await personSession(ada, { env, fetch: e.f });
    expect(s).toEqual({ token: "tok-ada@example.com", projectId: "proj-ada@example.com", userId: "u-ada@example.com" });
    expect([...e.accounts.keys()]).toEqual(["flow-service@suite.test", "ada@example.com"]);
    expect(e.pieces).toEqual(["@synergy/piece-synergy@0.1.0"]);
    expect(e.connections).toHaveLength(1);
    const c = e.connections[0];
    expect(c).toMatchObject({ externalId: "synergy", pieceName: "@synergy/piece-synergy", projectId: "proj-ada@example.com", type: "CUSTOM_AUTH" });
    expect(c.value.props.baseUrl).toBe("http://flow:3720");
    expect(keyOwner(c.value.props.key, env)).toEqual({ email: "ada@example.com", subject: "sub-1", name: "Ada Lovelace" });
    expect(c.token).toBe("Bearer tok-ada@example.com");
  });

  it("signs a returning person in without creating anything, and reuses the session for a while", async () => {
    const e = engine();
    await personSession(ada, { env, fetch: e.f });
    const before = e.log.length;
    await personSession(ada, { env, fetch: e.f });
    expect(e.log.length).toBe(before);
    resetServiceSession();
    await personSession(ada, { env, fetch: e.f });
    expect(e.log.slice(before).filter((l) => l.includes("sign-up"))).toEqual([]);
  });

  it("search never creates an engine account", async () => {
    const e = engine();
    expect(await existingSession(ada, { env, fetch: e.f })).toBeNull();
    expect(e.accounts.size).toBe(0);
  });

  it("explains an account it can't open", async () => {
    const e = engine();
    e.accounts.set("ada@example.com", "someone-elses-password");
    await expect(personSession(ada, { env, fetch: e.f })).rejects.toThrow(/FLOW_SECRET/);
  });
});
