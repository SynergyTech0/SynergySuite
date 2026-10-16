import { EMPTY_DLP, evaluateDlp, type DlpContext, type DlpDecision, type DlpIncident, type DlpSettings } from "./dlp";
import { DEFAULT_LABEL_SETTINGS, type LabelSettings } from "./labels";
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

/** The policy client with the sensitivity labels and DLP rules the same feed carries. */
export interface ProtectionClient extends PolicyClient {
  /**
   * The suite's sensitivity labels. When the Admin center can't be reached, the last list it gave;
   * without an Admin center (or before it has answered once), the default four labels.
   */
  labels(): Promise<LabelSettings>;
  /** The DLP rules: the last ones the Admin center gave, or none. */
  dlpSettings(): Promise<DlpSettings>;
  /** What happens to content about to leave (see evaluateDlp); the app is filled in. */
  checkDlp(ctx: Omit<DlpContext, "app">): Promise<DlpDecision>;
  /** Tells the Admin center a rule matched. Never throws: a lost report must not stop the app. */
  reportDlp(incident: Omit<DlpIncident, "app">): Promise<void>;
}

type State = { policy: Policy | null; at: number; ok: boolean };

/**
 * Asks the Admin center which people are on hold and how long content may be kept. Without
 * ADMIN_INTERNAL_URL the suite has no Admin center: nobody is on hold and nothing expires.
 */
export function createPolicyClient(opts: PolicyClientOptions): ProtectionClient {
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
    async labels() {
      const s = await load();
      return s.policy?.labels ?? DEFAULT_LABEL_SETTINGS;
    },
    async dlpSettings() {
      const s = await load();
      const dlp = s.policy?.dlp ?? EMPTY_DLP;
      // Without an Admin center (or one that lists no domains) the suite's own mail domain is
      // still inside, so a label that keeps mail inside doesn't stop mail to colleagues.
      if (dlp.internalDomains.length) return dlp;
      const own = [process.env.MAIL_DOMAIN, process.env.SUITE_DOMAIN].map((d) => (d ?? "").trim().toLowerCase()).filter(Boolean);
      return { ...dlp, internalDomains: [...new Set(own)] };
    },
    async checkDlp(ctx) {
      return evaluateDlp(await this.dlpSettings(), { ...ctx, app: opts.app });
    },
    async reportDlp(incident) {
      if (!url) return;
      try {
        const res = await doFetch(`${url}/api/svc/dlp/incidents`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ...incident, app: opts.app }),
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
      } catch (err) {
        console.error(`[${opts.app}] couldn't report a DLP incident:`, (err as Error).message);
      }
    },
    invalidate() {
      // Keep the last policy for labels and DLP while the next one loads.
      state = { policy: state.policy, at: 0, ok: false };
    },
  };
}
