// Fetching a web address for Get data on the server, without letting it
// reach the server's own network: only http and https, standard web ports,
// no user names in the address, and every address the name resolves to must
// be public (not loopback, private, link-local, carrier-grade NAT, multicast
// or reserved). The connection goes to the address that was checked, so a
// second DNS answer can't swap in a private one, and each redirect is checked
// the same way. IMPORT_ALLOW_HOSTS (comma-separated host names or addresses)
// lets an administrator allow particular internal hosts.
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const PORTS = new Set([80, 443, 8080, 8443]);

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

/** True for addresses Get data must not reach. */
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
    (process.env.IMPORT_ALLOW_HOSTS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

export class FetchRefused extends Error {}

/** Checks an address and picks the IP to connect to. */
export async function checkUrl(raw: string): Promise<{ url: URL; address: string; family: number }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchRefused("That is not a web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchRefused("Only http and https addresses can be used.");
  if (url.username || url.password) throw new FetchRefused("Addresses with a user name or password can't be used.");
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const allow = allowed();
  const trusted = allow.has(host);
  if (!trusted && !PORTS.has(port)) throw new FetchRefused("Only the standard web ports (80, 443, 8080, 8443) can be used.");
  let addresses: { address: string; family: number }[];
  if (net.isIP(host)) addresses = [{ address: host, family: net.isIP(host) }];
  else {
    try {
      addresses = await lookup(host, { all: true, verbatim: true });
    } catch {
      throw new FetchRefused(`The address ${host} could not be found.`);
    }
  }
  if (!addresses.length) throw new FetchRefused(`The address ${host} could not be found.`);
  if (!trusted) {
    const bad = addresses.find((a) => isPrivateAddress(a.address) && !allow.has(a.address));
    if (bad) throw new FetchRefused("That address is on a private or local network, which Get data can't reach.");
  }
  return { url, ...addresses[0] };
}

export type Fetched = { status: number; contentType: string; text: string; url: string };

function once(target: { url: URL; address: string; family: number }): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const lib = target.url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      target.url,
      {
        method: "GET",
        headers: { "user-agent": "SynergyOffice-GetData/1.0", accept: "text/csv,application/json,text/html;q=0.9,*/*;q=0.5" },
        timeout: TIMEOUT_MS,
        // Connect to the address that was checked.
        lookup: (_host: string, opts: any, cb: any) => (opts?.all ? cb(null, [{ address: target.address, family: target.family }]) : cb(null, target.address, target.family)),
      } as http.RequestOptions,
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) {
            req.destroy(new FetchRefused(`The data is larger than ${MAX_BYTES / 1024 / 1024} MB.`));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new FetchRefused("The address took too long to answer.")));
    req.on("error", reject);
    req.end();
  });
}

/** GETs an address under the rules above, following up to 5 redirects. */
export async function safeFetch(raw: string): Promise<Fetched> {
  let next = raw;
  for (let hop = 0; hop <= 5; hop++) {
    const target = await checkUrl(next);
    const res = await once(target);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      next = new URL(res.headers.location, target.url).toString();
      continue;
    }
    if (res.status >= 400) throw new FetchRefused(`The address answered ${res.status}.`);
    const contentType = String(res.headers["content-type"] || "");
    const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().toLowerCase();
    let text: string;
    try {
      text = new TextDecoder(charset || "utf-8").decode(res.body);
    } catch {
      text = new TextDecoder("utf-8").decode(res.body);
    }
    return { status: res.status, contentType, text, url: target.url.toString() };
  }
  throw new FetchRefused("Too many redirects.");
}
