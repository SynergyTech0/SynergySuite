import { afterEach, describe, expect, it, vi } from "vitest";
import { OAuthError, accessToken, checkPending, finishSignIn, idClaims, microsoftConfig, publicUrl, startSignIn } from "../lib/oauth";
import { open, seal } from "../lib/secret";
import { fromMx, detectProvider, GODADDY_WORKSPACE } from "../lib/detect";

const config = { clientId: "app-id", clientSecret: "shh", tenant: "common", redirectUri: "https://mail.example.com/api/oauth/microsoft/callback" };
const jwt = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("Sign in with Microsoft", () => {
  it("is off until the app registration is configured, and derives the redirect URI", () => {
    expect(microsoftConfig({})).toBeNull();
    expect(microsoftConfig({ MAIL_MICROSOFT_CLIENT_ID: "a", MAIL_MICROSOFT_CLIENT_SECRET: "b", SUITE_DOMAIN: "corp.test" }))
      .toEqual({ clientId: "a", clientSecret: "b", tenant: "common", redirectUri: "https://mail.corp.test/api/oauth/microsoft/callback" });
    expect(publicUrl({ MAIL_PUBLIC_URL: "https://webmail.corp.test/" })).toBe("https://webmail.corp.test");
    expect(publicUrl({})).toBe("http://localhost:3200");
  });

  it("asks for IMAP, SMTP and offline access with PKCE, and only takes its own state back", () => {
    const { url, cookie } = startSignIn(config, "shane@corp.test", "shane@company.com");
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    const scope = u.searchParams.get("scope")!.split(" ");
    expect(scope).toEqual(expect.arrayContaining(["offline_access", "https://outlook.office.com/IMAP.AccessAsUser.All", "https://outlook.office.com/SMTP.Send"]));
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("login_hint")).toBe("shane@company.com");
    const state = u.searchParams.get("state")!;
    expect(checkPending(cookie, "shane@corp.test", state)).toMatchObject({ user: "shane@corp.test" });
    expect(checkPending(cookie, "someone@corp.test", state)).toBeNull();
    expect(checkPending(cookie, "shane@corp.test", "other")).toBeNull();
    expect(checkPending("tampered", "shane@corp.test", state)).toBeNull();
    expect(checkPending(undefined, "shane@corp.test", state)).toBeNull();
  });

  it("trades the code for tokens and reads the mailbox from the ID token", async () => {
    const fetch = vi.fn(async () => reply(200, { access_token: "at", refresh_token: "rt", expires_in: 3600, id_token: jwt({ preferred_username: "Shane@Company.com", name: "Shane" }) }));
    vi.stubGlobal("fetch", fetch);
    const s = await finishSignIn(config, "the-code", "verifier");
    expect(s).toMatchObject({ address: "shane@company.com", name: "Shane", accessToken: "at", refreshToken: "rt" });
    const body = new URLSearchParams((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("verifier");
  });

  it("refreshes access tokens once, caches them and saves a rotated refresh token", async () => {
    const fetch = vi.fn(async () => reply(200, { access_token: "fresh", refresh_token: "rt2", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetch);
    const saved: string[] = [];
    const rotate = async (s: string) => { saved.push(s); };
    const [a, b] = await Promise.all([accessToken("acct-1", seal("rt1"), rotate, config), accessToken("acct-1", seal("rt1"), rotate, config)]);
    expect([a, b]).toEqual(["fresh", "fresh"]);
    expect(await accessToken("acct-1", seal("rt1"), rotate, config)).toBe("fresh");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).get("refresh_token")).toBe("rt1");
    expect(saved.map(open)).toContain("rt2");
  });

  it("reports a revoked sign-in as expired, with Microsoft's reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(400, { error: "invalid_grant", error_description: "AADSTS70008: The refresh token has expired.\r\nTrace ID: 1" })));
    const err = await accessToken("acct-2", seal("old"), async () => undefined, config).catch((e) => e);
    expect(err).toBeInstanceOf(OAuthError);
    expect(err.expired).toBe(true);
    expect(err.message).toBe("The refresh token has expired.");
  });

  it("reads claims defensively", () => {
    expect(idClaims(undefined)).toEqual({});
    expect(idClaims("not-a-jwt")).toEqual({});
  });
});

describe("who hosts an address", () => {
  it("knows Microsoft 365 (GoDaddy's too) and GoDaddy Workspace from MX records", () => {
    expect(fromMx(["company-com.mail.protection.outlook.com."])).toEqual({ kind: "microsoft" });
    expect(fromMx(["mailstore1.secureserver.net", "smtp.secureserver.net"])).toEqual(GODADDY_WORKSPACE);
    expect(fromMx(["aspmx.l.google.com"])).toBeNull();
  });

  it("knows Outlook.com without a lookup and survives DNS failures", async () => {
    const lookup = vi.fn(async () => { throw new Error("ENOTFOUND"); });
    expect(await detectProvider("me@hotmail.com", lookup)).toEqual({ kind: "microsoft" });
    expect(lookup).not.toHaveBeenCalled();
    expect(await detectProvider("me@company.com", lookup)).toBeNull();
    expect(await detectProvider("garbage", lookup)).toBeNull();
    expect(await detectProvider("me@company.com", async () => [{ exchange: "company-com.mail.protection.outlook.com" }])).toEqual({ kind: "microsoft" });
  });
});
