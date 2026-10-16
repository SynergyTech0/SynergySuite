import { describe, expect, it } from "vitest";
import { enginePassword, keyOwner, personKey, serviceAccount } from "../lib/keys";

const env = { FLOW_SECRET: "a-test-secret-that-is-long", SUITE_DOMAIN: "suite.test" } as unknown as NodeJS.ProcessEnv;
const other = { ...env, FLOW_SECRET: "another-secret-entirely" } as unknown as NodeJS.ProcessEnv;
const ada = { email: "Ada@Example.com", subject: "sub-123", name: "Ada Lovelace" };

describe("Synergy keys", () => {
  it("round-trips the person, with the email lowercased", () => {
    expect(keyOwner(personKey(ada, env), env)).toEqual({ email: "ada@example.com", subject: "sub-123", name: "Ada Lovelace" });
  });

  it("refuses a key made with another secret, or tampered with", () => {
    const key = personKey(ada, env);
    expect(keyOwner(key, other)).toBeNull();
    const [p, body, sig] = key.split(".");
    const forged = Buffer.from(JSON.stringify({ e: "boss@example.com", s: "x", n: "" })).toString("base64url");
    expect(keyOwner(`${p}.${forged}.${sig}`, env)).toBeNull();
    expect(keyOwner(`${p}.${body}.${sig.slice(0, -2)}`, env)).toBeNull();
    expect(keyOwner("", env)).toBeNull();
    expect(keyOwner("sfk1.x.y.z", env)).toBeNull();
  });

  it("needs a real FLOW_SECRET", () => {
    expect(() => personKey(ada, { FLOW_SECRET: "short" } as unknown as NodeJS.ProcessEnv)).toThrow(/FLOW_SECRET/);
    expect(() => personKey(ada, {} as unknown as NodeJS.ProcessEnv)).toThrow(/FLOW_SECRET/);
  });

  it("derives stable, per-person engine passwords", () => {
    expect(enginePassword("ada@example.com", env)).toBe(enginePassword("ADA@example.com", env));
    expect(enginePassword("ada@example.com", env)).not.toBe(enginePassword("bob@example.com", env));
    expect(enginePassword("ada@example.com", env)).not.toBe(enginePassword("ada@example.com", other));
    expect(serviceAccount(env).email).toBe("flow-service@suite.test");
  });
});
