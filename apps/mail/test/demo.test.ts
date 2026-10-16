import { describe, expect, it } from "vitest";
import { checkDemoSend, demoMode } from "../lib/demo";

const demo = { DEMO_MODE: "1", SUITE_DOMAIN: "suite.example", MAIL_DOMAIN: "mail.example" };

describe("demo mode", () => {
  it("is off unless DEMO_MODE is 1", () => {
    expect(demoMode({})).toBe(false);
    expect(demoMode({ DEMO_MODE: "true" })).toBe(false);
    expect(demoMode(demo)).toBe(true);
    expect(() => checkDemoSend("7", ["someone@elsewhere.example"], {})).not.toThrow();
  });

  it("only sends from the suite mailbox to the mail domain", () => {
    expect(() => checkDemoSend("suite", ["a@mail.example", "B <b@MAIL.example>"], demo)).not.toThrow();
    expect(() => checkDemoSend("suite", ["a@mail.example", "x@elsewhere.example"], demo)).toThrow(/x@elsewhere\.example/);
    expect(() => checkDemoSend("suite", ["x@sub.mail.example"], demo)).toThrow(/demo/);
    expect(() => checkDemoSend("suite", ["x@suite.example"], demo)).toThrow(/demo/);
    expect(() => checkDemoSend("7", ["a@mail.example"], demo)).toThrow(/suite mailbox/);
  });

  it("falls back to the suite domain", () => {
    const env = { DEMO_MODE: "1", SUITE_DOMAIN: "suite.example" };
    expect(() => checkDemoSend("suite", ["a@suite.example"], env)).not.toThrow();
  });
});
