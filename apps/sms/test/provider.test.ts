import { describe, expect, it } from "vitest";
import { publicUrl, twilio, twilioSignature, verifyTwilio } from "../lib/provider";
import { twilioParams } from "../lib/webhook";

// The example from Twilio's webhook security documentation.
const TOKEN = "12345";
const URL_ = "https://mycompany.com/myapp.php?foo=1&bar=2";
const PARAMS = { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" };

describe("Twilio signatures", () => {
  it("matches Twilio's documented example", () => {
    expect(twilioSignature(TOKEN, URL_, PARAMS)).toBe("0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
    expect(verifyTwilio(TOKEN, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=", URL_, PARAMS)).toBe(true);
  });

  it("refuses a wrong token, URL, parameter or signature", () => {
    const sig = twilioSignature(TOKEN, URL_, PARAMS);
    expect(verifyTwilio("54321", sig, URL_, PARAMS)).toBe(false);
    expect(verifyTwilio(TOKEN, sig, "https://mycompany.com/myapp.php?foo=1&bar=3", PARAMS)).toBe(false);
    expect(verifyTwilio(TOKEN, sig, URL_, { ...PARAMS, Digits: "1235" })).toBe(false);
    expect(verifyTwilio(TOKEN, sig, URL_, { ...PARAMS, Extra: "" })).toBe(false);
    expect(verifyTwilio(TOKEN, null, URL_, PARAMS)).toBe(false);
    expect(verifyTwilio(TOKEN, "short", URL_, PARAMS)).toBe(false);
    expect(verifyTwilio("", sig, URL_, PARAMS)).toBe(false);
  });

  const env = { TWILIO_AUTH_TOKEN: "secret-token", SUITE_DOMAIN: "example.org" };
  const post = (params: Record<string, string>, sig: string | null, path = "/api/webhooks/twilio/inbound", type = "application/x-www-form-urlencoded") =>
    new Request(`http://sms:3920${path}`, {
      method: "POST",
      headers: { "content-type": type, ...(sig ? { "x-twilio-signature": sig } : {}) },
      body: new URLSearchParams(params).toString(),
    });

  it("reads a webhook signed for the public address, whatever host the app saw", async () => {
    const p = { From: "+15551234567", Body: "hi", MessageSid: "SM1" };
    const sig = twilioSignature("secret-token", "https://sms.example.org/api/webhooks/twilio/inbound", p);
    expect(await twilioParams(post(p, sig), env)).toEqual(p);
    expect(await twilioParams(post(p, sig), { ...env, SMS_PUBLIC_URL: "https://texts.example.net/" })).toBeNull();
    const sig2 = twilioSignature("secret-token", "https://texts.example.net/api/webhooks/twilio/inbound", p);
    expect(await twilioParams(post(p, sig2), { ...env, SMS_PUBLIC_URL: "https://texts.example.net/" })).toEqual(p);
  });

  it("refuses unsigned, forged and non-form webhooks, and any webhook without a token", async () => {
    const p = { From: "+15551234567", Body: "hi" };
    const sig = twilioSignature("secret-token", "https://sms.example.org/api/webhooks/twilio/inbound", p);
    expect(await twilioParams(post(p, null), env)).toBeNull();
    expect(await twilioParams(post({ ...p, Body: "STOP" }, sig), env)).toBeNull();
    expect(await twilioParams(post(p, sig, "/api/webhooks/twilio/inbound", "application/json"), env)).toBeNull();
    expect(await twilioParams(post(p, sig), { SUITE_DOMAIN: "example.org" })).toBeNull();
  });

  it("builds the public address from SMS_PUBLIC_URL or the suite domain", () => {
    expect(publicUrl("/x", { SUITE_DOMAIN: "example.org" })).toBe("https://sms.example.org/x");
    expect(publicUrl("/x", { SMS_PUBLIC_URL: "https://a.example/", SUITE_DOMAIN: "example.org" })).toBe("https://a.example/x");
    expect(publicUrl("/x", {})).toBe("");
  });
});

describe("Twilio sending", () => {
  it("posts the text with Basic auth and a status callback", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ sid: "SM123", status: "queued" }), { status: 201 });
    }) as unknown as typeof fetch;
    const p = twilio({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM_NUMBER: "+15550001111", SUITE_DOMAIN: "example.org" }, fake);
    expect(p.configured).toBe(true);
    expect(await p.send("+15551234567", "Hello")).toEqual({ ok: true, id: "SM123", status: "queued" });
    expect(seen!.url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
    expect((seen!.init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("AC1:tok").toString("base64")}`);
    const form = new URLSearchParams(String(seen!.init.body));
    expect(Object.fromEntries(form)).toEqual({
      To: "+15551234567",
      Body: "Hello",
      From: "+15550001111",
      StatusCallback: "https://sms.example.org/api/webhooks/twilio/status",
    });
  });

  it("uses a Messaging Service when one is set, and reports Twilio's errors", async () => {
    const fake = (async (_url: string, init: RequestInit) => {
      const form = new URLSearchParams(String(init.body));
      expect(form.get("MessagingServiceSid")).toBe("MG1");
      expect(form.get("From")).toBeNull();
      return new Response(JSON.stringify({ message: "The 'To' number is not a valid phone number." }), { status: 400 });
    }) as unknown as typeof fetch;
    const p = twilio({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", TWILIO_MESSAGING_SERVICE_SID: "MG1" }, fake);
    expect(await p.send("+1", "x")).toEqual({ ok: false, error: "The 'To' number is not a valid phone number." });
    expect(twilio({}).configured).toBe(false);
    expect(await twilio({}).send("+15551234567", "x")).toMatchObject({ ok: false });
  });
});
