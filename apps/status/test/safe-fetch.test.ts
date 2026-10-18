import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkUrlShape, isPrivateAddress, probe } from "../lib/safe-fetch";
import { isUp } from "../lib/monitors";

describe("private address check", () => {
  it("blocks loopback, private, link-local, CGNAT and mapped forms", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::10.0.0.1"]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
  });
  it("lets public addresses through", () => {
    for (const a of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"]) expect(isPrivateAddress(a), a).toBe(false);
  });
  it("treats anything that isn't an IP as blocked", () => {
    expect(isPrivateAddress("example.com")).toBe(true);
  });
});

describe("address shape when a monitor is saved", () => {
  it("accepts ordinary web addresses", () => {
    expect(checkUrlShape("https://example.com/health").toString()).toBe("https://example.com/health");
    expect(checkUrlShape("http://1.1.1.1:8080/").hostname).toBe("1.1.1.1");
  });
  it("refuses other schemes, user names, odd ports and internal names", () => {
    for (const u of ["ftp://example.com", "file:///etc/passwd", "https://u:p@example.com", "https://example.com:22", "http://localhost", "http://127.0.0.1", "http://[::1]/", "http://db", "http://printer.local", "http://x.internal", "not a url"]) {
      expect(() => checkUrlShape(u), u).toThrow();
    }
  });
});

describe("up or down", () => {
  it("counts the expected status and any 2xx/3xx as up", () => {
    expect(isUp(200, 200)).toBe(true);
    expect(isUp(302, 200)).toBe(true);
    expect(isUp(401, 401)).toBe(true);
    expect(isUp(500, 200)).toBe(false);
    expect(isUp(null, 200)).toBe(false);
  });
});

describe("probe", () => {
  let server: http.Server;
  let base = "";
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/ok") return void res.end("fine");
      if (req.url === "/fail") return void (res.writeHead(503), res.end());
      if (req.url === "/to-metadata") return void (res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }), res.end());
      if (req.url === "/to-ok") return void (res.writeHead(301, { location: "/ok" }), res.end());
      if (req.url === "/loop") return void (res.writeHead(302, { location: "/loop" }), res.end());
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    delete process.env.STATUS_ALLOW_HOSTS;
    server.close();
  });

  it("refuses a loopback address unless an admin allows it", async () => {
    delete process.env.STATUS_ALLOW_HOSTS;
    const r = await probe(`${base}/ok`);
    expect(r.status).toBeNull();
    expect(r.error).toBeTruthy();
  });

  it("checks an allowed host and follows its redirects", async () => {
    process.env.STATUS_ALLOW_HOSTS = "127.0.0.1";
    expect((await probe(`${base}/ok`)).status).toBe(200);
    expect((await probe(`${base}/to-ok`)).status).toBe(200);
    expect((await probe(`${base}/fail`)).status).toBe(503);
  });

  it("checks every redirect: an allowed host can't bounce the check to a private address", async () => {
    process.env.STATUS_ALLOW_HOSTS = "127.0.0.1";
    const r = await probe(`${base}/to-metadata`);
    expect(r.status).toBeNull();
    expect(r.error).toMatch(/private or local/);
  });

  it("gives up after five redirects", async () => {
    process.env.STATUS_ALLOW_HOSTS = "127.0.0.1";
    expect((await probe(`${base}/loop`)).error).toMatch(/redirects/);
  });
});
