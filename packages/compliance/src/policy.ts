import type { Policy, RetentionRule } from "./protocol";

export interface PolicyClientOptions {
  /** This app's id in the suite registry, e.g. "drive". */
  app: string;
  /** Admin center base URL on the internal network; default ADMIN_INTERNAL_URL. */
  url?: string;
  token?: string;
  /** How long a fetched policy is trusted. */
  ttlMs?: number;
  fetch?: typeof fetch;
}

export interface PolicyClient {
  /** Whether this person's content in this app must be kept. Fails closed: if the Admin center is configured but unreachable, everyone is on hold. */
  onHold(email: string): Promise<boolean>;
  /** The retention rules for this app (most specific kind first). Empty when the Admin center is unreachable, so nothing is deleted. */
  retention(): Promise<RetentionRule[]>;
  /** Days content of this kind may live, or null to keep it. The shortest matching rule wins. */
  retentionDays(kind: string): Promise<number | null>;
  /** Drop the cached policy, e.g. after the Admin center pushes a change. */
  invalidate(): void;
}

type State = { policy: Policy | null; at: number; ok: boolean };

/**
 * Asks the Admin center which people are on hold and how long content may be kept. Without
 * ADMIN_INTERNAL_URL the suite has no Admin center: nobody is on hold and nothing expires.
 */
export function createPolicyClient(opts: PolicyClientOptions): PolicyClient {
  const url = (opts.url ?? process.env.ADMIN_INTERNAL_URL ?? "").replace(/\/$/, "");
  const token = opts.token ?? process.env.COMPLIANCE_TOKEN ?? "";
  const ttl = opts.ttlMs ?? 60_000;
  const doFetch = opts.fetch ?? fetch;
  let state: State = { policy: null, at: 0, ok: false };
  let inflight: Promise<State> | null = null;

  async function load(): Promise<State> {
    if (!url) return { policy: { holds: [], retention: [], updatedAt: "" }, at: Date.now(), ok: true };
    if (Date.now() - state.at < (state.ok ? ttl : 5_000)) return state;
    inflight ??= (async () => {
      try {
        const res = await doFetch(`${url}/api/svc/policy`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) throw new Error(`policy ${res.status}`);
        const policy = (await res.json()) as Policy;
        state = { policy, at: Date.now(), ok: true };
      } catch {
        state = { policy: state.policy, at: Date.now(), ok: false };
      } finally {
        inflight = null;
      }
      return state;
    })();
    return inflight;
  }

  const covers = (apps: string[]) => apps.length === 0 || apps.includes(opts.app);

  return {
    async onHold(email) {
      const s = await load();
      if (!s.ok) return true;
      const e = email.trim().toLowerCase();
      return s.policy!.holds.some((h) => covers(h.apps) && h.custodians.includes(e));
    },
    async retention() {
      const s = await load();
      if (!s.ok) return [];
      return s.policy!.retention.filter((r) => r.app === opts.app).sort((a, b) => Number(!!b.kind) - Number(!!a.kind));
    },
    async retentionDays(kind) {
      const rules = (await this.retention()).filter((r) => !r.kind || r.kind === kind);
      return rules.length ? Math.min(...rules.map((r) => r.days)) : null;
    },
    invalidate() {
      state = { policy: null, at: 0, ok: false };
    },
  };
}
