// Checking a monitor's address from the server without letting a monitor reach the server's own
// network: only http and https, standard web ports, no user names in the address, and every
// address the name resolves to must be public (not loopback, private, link-local, carrier-grade
// NAT, multicast or reserved). The connection goes to the address that was checked, so a second
// DNS answer can't swap in a private one, and each redirect is checked the same way before it is
// followed. STATUS_ALLOW_HOSTS (comma-separated host names or addresses) lets an administrator
// allow particular internal hosts, such as the suite's own apps on a private network.
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const PORTS = new Set([80, 443, 8080, 8443]);
const MAX_REDIRECTS = 5;
/** Only this much of a response body is read; a status check needs none of it. */
const MAX_BODY = 64 * 1024;

const blocked = new net.BlockList();
for (const [a, n] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(a, n, "ipv4");
for (const [a, n] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const)
  blocked.addSubnet(a, n, "ipv6");

/** True for addresses a monitor must not reach. */
export function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family !== 6) return true;
  const lower = address.toLowerCase();
  // IPv4 inside IPv6 (mapped, compatible, NAT64): check the IPv4 part.
  const v4 = /^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1];
  if (v4) return blocked.check(v4, "ipv4");
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
    return blocked.check([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."), "ipv4");
  }
  return blocked.check(address, "ipv6");
}

const allowed = () =>
  new Set(
    (process.env.STATUS_ALLOW_HOSTS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

export class ProbeRefused extends Error {}

/** The parts of an address that can be judged without a DNS lookup; used when a monitor is saved. */
export function checkUrlShape(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProbeRefused("That is not a web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ProbeRefused("Only http and https addresses can be monitored.");
  if (url.username || url.password) throw new ProbeRefused("Addresses with a user name or password can't be monitored.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const allow = allowed();
  if (allow.has(host)) return url;
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (!PORTS.has(port)) throw new ProbeRefused("Only the standard web ports (80, 443, 8080, 8443) can be monitored.");
  if (net.isIP(host) && isPrivateAddress(host)) throw new ProbeRefused("That address is on a private or local network.");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local") || (!net.isIP(host) && !host.includes("."))) {
    throw new ProbeRefused("That address is on a private or local network.");
  }
  return url;
}

type Target = { url: URL; address: string; family: number };

/** Checks an address and picks the IP to connect to. */
export async function checkUrl(raw: string): Promise<Target> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProbeRefused("That is not a web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ProbeRefused("Only http and https addresses can be monitored.");
  if (url.username || url.password) throw new ProbeRefused("Addresses with a user name or password can't be monitored.");
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const allow = allowed();
  const trusted = allow.has(host);
  if (!trusted && !PORTS.has(port)) throw new ProbeRefused("Only the standard web ports (80, 443, 8080, 8443) can be monitored.");
  let addresses: { address: string; family: number }[];
  if (net.isIP(host)) addresses = [{ address: host, family: net.isIP(host) }];
  else {
    try {
      addresses = await lookup(host, { all: true, verbatim: true });
    } catch {
      throw new ProbeRefused(`The address ${host} could not be found.`);
    }
  }
  if (!addresses.length) throw new ProbeRefused(`The address ${host} could not be found.`);
  if (!trusted) {
    const bad = addresses.find((a) => isPrivateAddress(a.address) && !allow.has(a.address));
    if (bad) throw new ProbeRefused("That address is on a private or local network.");
  }
  return { url, ...addresses[0] };
}

function once(target: Target, timeoutMs: number): Promise<{ status: number; location?: string }> {
  const lib = target.url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      target.url,
      {
        method: "GET",
        headers: { "user-agent": "SynergyStatus/1.0 (uptime check)", accept: "*/*" },
        timeout: timeoutMs,
        // Connect to the address that was checked.
        lookup: (_host: string, opts: any, cb: any) => (opts?.all ? cb(null, [{ address: target.address, family: target.family }]) : cb(null, target.address, target.family)),
      } as http.RequestOptions,
      (res) => {
        let size = 0;
        const done = () => resolve({ status: res.statusCode || 0, location: res.headers.location });
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BODY) {
            res.destroy();
            done();
          }
        });
        res.on("end", done);
        res.on("close", done);
        res.on("error", () => done());
      },
    );
    req.on("timeout", () => req.destroy(new ProbeRefused("No answer in time.")));
    req.on("error", reject);
    req.end();
  });
}

export type ProbeResult = { status: number | null; latencyMs: number; error: string | null };

/**
 * GETs an address under the rules above, following up to 5 redirects (each one checked), and
 * reports the final status code and how long it took. Never throws.
 */
export async function probe(raw: string, timeoutMs = 10_000): Promise<ProbeResult> {
  const started = Date.now();
  let next = raw;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const target = await checkUrl(next);
      const res = await once(target, timeoutMs);
      if (res.status >= 300 && res.status < 400 && res.location) {
        next = new URL(res.location, target.url).toString();
        continue;
      }
      return { status: res.status, latencyMs: Date.now() - started, error: null };
    }
    return { status: null, latencyMs: Date.now() - started, error: "Too many redirects." };
  } catch (err) {
    const msg = err instanceof ProbeRefused ? err.message : ((err as { code?: string }).code ?? (err as Error).message ?? "Failed");
    return { status: null, latencyMs: Date.now() - started, error: String(msg).slice(0, 200) };
  }
}
