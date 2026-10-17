/**
 * A small Microsoft Graph client over plain HTTPS: the client-credentials token from
 * login.microsoftonline.com, JSON pages that follow @odata.nextLink / @odata.deltaLink, raw
 * downloads, and retries that honour throttling (429 or 503 with Retry-After) as Microsoft asks.
 * M365_LOGIN_URL and M365_GRAPH_URL point it elsewhere (national clouds, the tests' fake Graph).
 */

export type GraphCreds = { tenantId: string; clientId: string; clientSecret: string };

export type GraphOptions = {
  fetch?: typeof fetch;
  loginUrl?: string;
  graphUrl?: string;
  /** Attempts per request before giving up on throttling or a dropped connection. */
  maxRetries?: number;
  /** Longest wait between attempts, in ms (Retry-After above it is cut to it). */
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

export class GraphError extends Error {
  constructor(message: string, public status: number, public code = "") {
    super(message);
  }
}

export type Page<T> = { value: T[]; nextLink?: string; deltaLink?: string };

const GUID_OR_DOMAIN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/;

export function graphEnv(env: NodeJS.ProcessEnv = process.env): { loginUrl: string; graphUrl: string } {
  return {
    loginUrl: (env.M365_LOGIN_URL || "https://login.microsoftonline.com").replace(/\/+$/, ""),
    graphUrl: (env.M365_GRAPH_URL || "https://graph.microsoft.com/v1.0").replace(/\/+$/, ""),
  };
}

/** What a token error from Microsoft means, in words an admin can act on. */
function explainToken(status: number, body: { error?: string; error_description?: string } | null): string {
  const code = String(body?.error_description ?? "").match(/AADSTS\d+/)?.[0] ?? "";
  if (code === "AADSTS7000215" || code === "AADSTS7000222") return "Microsoft refused the client secret (wrong value, or it expired). Paste the secret's Value, not its ID.";
  if (code === "AADSTS700016") return "Microsoft doesn't know that client (application) ID in this tenant.";
  if (code === "AADSTS90002" || code === "AADSTS900023") return "Microsoft doesn't know that tenant ID.";
  if (body?.error === "invalid_client") return "Microsoft refused the client ID or secret.";
  return `Microsoft's sign-in answered ${status}${code ? ` (${code})` : ""}.`;
}

export class Graph {
  private token = "";
  private expires = 0;
  private readonly f: typeof fetch;
  private readonly loginUrl: string;
  private readonly graphUrl: string;
  private readonly maxRetries: number;
  private readonly maxWaitMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  /** How often Microsoft asked us to slow down, for the report. */
  throttled = 0;

  constructor(private readonly creds: GraphCreds, opts: GraphOptions = {}) {
    const env = graphEnv();
    this.f = opts.fetch ?? fetch;
    this.loginUrl = (opts.loginUrl ?? env.loginUrl).replace(/\/+$/, "");
    this.graphUrl = (opts.graphUrl ?? env.graphUrl).replace(/\/+$/, "");
    this.maxRetries = opts.maxRetries ?? 8;
    this.maxWaitMs = opts.maxWaitMs ?? 120_000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    if (!GUID_OR_DOMAIN.test(creds.tenantId)) throw new GraphError("The tenant ID doesn't look right", 400);
  }

  private async getToken(force = false): Promise<string> {
    if (!force && this.token && Date.now() < this.expires) return this.token;
    const body = new URLSearchParams({
      client_id: this.creds.clientId,
      client_secret: this.creds.clientSecret,
      scope: `${new URL(this.graphUrl).origin}/.default`,
      grant_type: "client_credentials",
    });
    let res: Response | null = null;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await this.f(`${this.loginUrl}/${encodeURIComponent(this.creds.tenantId)}/oauth2/v2.0/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        if (attempt >= 3) throw new GraphError("Couldn't reach Microsoft's sign-in service", 502);
        await this.sleep(1000 * 2 ** attempt);
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await res.arrayBuffer().catch(() => {});
        await this.sleep(this.wait(res, attempt));
        continue;
      }
      break;
    }
    const data = (await res!.json().catch(() => null)) as { access_token?: string; expires_in?: number; error?: string; error_description?: string } | null;
    if (!res!.ok || !data?.access_token) throw new GraphError(explainToken(res!.status, data), res!.status === 400 || res!.status === 401 ? 401 : 502, data?.error ?? "");
    this.token = data.access_token;
    this.expires = Date.now() + Math.max(60, (data.expires_in ?? 3600) - 120) * 1000;
    return this.token;
  }

  /** A path under the Graph URL, or a nextLink/deltaLink Microsoft gave (only on the same host). */
  url(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) {
      if (new URL(pathOrUrl).origin !== new URL(this.graphUrl).origin) throw new GraphError("Microsoft sent a link to another host", 502);
      return pathOrUrl;
    }
    return `${this.graphUrl}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
  }

  private wait(res: Response, attempt: number): number {
    const ra = res.headers.get("retry-after");
    let ms = 0;
    if (ra && /^\d+(\.\d+)?$/.test(ra.trim())) ms = Number(ra) * 1000;
    else if (ra && !Number.isNaN(Date.parse(ra))) ms = Date.parse(ra) - Date.now();
    if (!(ms > 0)) ms = Math.min(1000 * 2 ** attempt, 60_000);
    return Math.min(ms, this.maxWaitMs);
  }

  /** One request, retried on throttling, server hiccups and dropped connections; 401 renews the token once. */
  async request(pathOrUrl: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<Response> {
    const url = this.url(pathOrUrl);
    let renewed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.getToken();
      let res: Response;
      try {
        res = await this.f(url, {
          ...init,
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...init.headers },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        if (attempt >= this.maxRetries) throw new GraphError(`Couldn't reach Microsoft Graph: ${(e as Error).message}`, 502);
        await this.sleep(Math.min(1000 * 2 ** attempt, 30_000));
        continue;
      }
      if (res.status === 401 && !renewed) {
        renewed = true;
        await res.arrayBuffer().catch(() => {});
        await this.getToken(true);
        attempt--;
        continue;
      }
      if ((res.status === 429 || res.status === 503 || res.status === 504 || res.status === 502) && attempt < this.maxRetries) {
        if (res.status === 429 || res.headers.get("retry-after")) this.throttled++;
        await res.arrayBuffer().catch(() => {});
        await this.sleep(this.wait(res, attempt));
        continue;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
        const code = body?.error?.code ?? "";
        throw new GraphError(body?.error?.message ? `Microsoft Graph: ${body.error.message}` : `Microsoft Graph answered ${res.status}`, res.status, code);
      }
      return res;
    }
  }

  async json<T>(pathOrUrl: string, headers: Record<string, string> = {}): Promise<T> {
    const res = await this.request(pathOrUrl, { headers });
    return (await res.json()) as T;
  }

  /** One page of a collection or a delta query. */
  async page<T>(pathOrUrl: string, headers: Record<string, string> = {}): Promise<Page<T>> {
    const d = await this.json<{ value?: T[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string }>(pathOrUrl, headers);
    return { value: Array.isArray(d.value) ? d.value : [], nextLink: d["@odata.nextLink"], deltaLink: d["@odata.deltaLink"] };
  }

  /** Every item of a collection, up to `max`. */
  async all<T>(path: string, headers: Record<string, string> = {}, max = 100_000): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = path;
    while (next && out.length < max) {
      const p: Page<T> = await this.page<T>(next, headers);
      out.push(...p.value);
      next = p.nextLink;
    }
    return out.slice(0, max);
  }

  /** The bytes at a path (a message's $value, a file's content), refusing more than `maxBytes`. */
  async bytes(path: string, maxBytes: number): Promise<Buffer> {
    const res = await this.request(path, { headers: { Accept: "*/*" } });
    const len = Number(res.headers.get("content-length") || 0);
    if (len > maxBytes) {
      await res.body?.cancel().catch(() => {});
      throw new TooLarge(len);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    if (res.body) {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (size > maxBytes) throw new TooLarge(size);
        chunks.push(Buffer.from(chunk));
      }
    }
    return Buffer.concat(chunks);
  }

  /** A download as a stream, for files of any size; the caller reads or cancels it. */
  async stream(path: string): Promise<{ body: ReadableStream<Uint8Array> | null; size: number | null }> {
    const res = await this.request(path, { headers: { Accept: "*/*" } });
    const len = res.headers.get("content-length");
    return { body: res.body, size: len ? Number(len) : null };
  }
}

export class TooLarge extends Error {
  constructor(public size: number) {
    super(`Too large (${size} bytes)`);
  }
}
