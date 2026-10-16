import { type InsightsConfig, config, derive, embeddingKey, isAdmin, isAnalyst, personPassword } from "./config";

/**
 * A small client for the Metabase REST API, used two ways: as Insights' own service account
 * (an admin in Metabase, made by the first-run setup) to set things up, and as each person, so
 * Metabase's own permissions decide what they can see.
 */

export class MetabaseError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type Fetch = typeof fetch;

export interface MetabaseUser {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  is_active: boolean;
  is_superuser: boolean;
}

/** The group whose members may write their own queries against the suite's databases. */
export const ANALYSTS_GROUP = "Synergy analysts";

/** Metabase wants a first name; a last name only when there is one. */
function splitName(name: string, email: string): { first_name: string; last_name?: string } {
  const parts = (name || email.split("@")[0]).trim().split(/\s+/);
  const last = parts.slice(1).join(" ");
  return { first_name: parts[0] || email, ...(last ? { last_name: last } : {}) };
}

export class Metabase {
  private serviceSession: string | null = null;
  private sessions = new Map<string, { id: string; at: number }>();
  private setupDone = false;
  private analystsGroup: number | null = null;

  constructor(public c: InsightsConfig = config(), private fetchImpl: Fetch = fetch) {}

  async call<T = unknown>(path: string, opts: { session?: string | null; method?: string; body?: unknown } = {}): Promise<T> {
    const res = await this.fetchImpl(this.c.metabaseUrl + path, {
      method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
      headers: {
        ...(opts.body === undefined ? {} : { "content-type": "application/json" }),
        ...(opts.session ? { "x-metabase-session": opts.session } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        const j = JSON.parse(text) as { message?: string; errors?: unknown };
        msg = j.message || (j.errors ? JSON.stringify(j.errors) : text);
      } catch {
        /* plain text */
      }
      throw new MetabaseError(res.status, `${res.status} ${path}: ${String(msg).slice(0, 300)}`);
    }
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  /** The Metabase version, for About. Null when Metabase can't be reached. */
  async version(): Promise<string | null> {
    try {
      const p = await this.call<{ version?: { tag?: string } }>("/api/session/properties");
      return p.version?.tag ?? null;
    } catch {
      return null;
    }
  }

  private servicePassword(): string {
    return "Sy1!" + derive(this.c.secret, "metabase-service");
  }

  /**
   * Metabase's first-run setup, done once by Insights: makes the service account (an admin
   * nobody signs in as) and names the site. Afterwards the setup token is gone and this is a no-op.
   */
  async ensureSetup(): Promise<void> {
    if (this.setupDone) return;
    const p = await this.call<{ "setup-token"?: string | null; "has-user-setup"?: boolean }>("/api/session/properties");
    if (p["setup-token"] && !p["has-user-setup"]) {
      await this.call("/api/setup", {
        body: {
          token: p["setup-token"],
          user: { email: this.c.serviceEmail, password: this.servicePassword(), first_name: "Synergy", last_name: "Insights", site_name: "Synergy Insights" },
          prefs: { site_name: "Synergy Insights", allow_tracking: false },
        },
      });
    }
    this.setupDone = true;
  }

  /** A session for the service account; made again when Metabase has ended it. */
  async service(): Promise<string> {
    if (this.serviceSession) return this.serviceSession;
    await this.ensureSetup();
    try {
      const s = await this.call<{ id: string }>("/api/session", { body: { username: this.c.serviceEmail, password: this.servicePassword() } });
      this.serviceSession = s.id;
      return s.id;
    } catch (err) {
      if (err instanceof MetabaseError && (err.status === 401 || err.status === 400)) {
        throw new Error(
          `Insights can't sign in to Metabase as ${this.c.serviceEmail}. Metabase was set up by someone else, or INSIGHTS_SECRET changed since it was set up.`,
        );
      }
      throw err;
    }
  }

  /** Calls the API as the service account, signing in again once if its session expired. */
  async asService<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
    const session = await this.service();
    try {
      return await this.call<T>(path, { ...opts, session });
    } catch (err) {
      if (!(err instanceof MetabaseError) || err.status !== 401) throw err;
      this.serviceSession = null;
      return this.call<T>(path, { ...opts, session: await this.service() });
    }
  }

  /** The settings Insights depends on: static embedding signed with its own key, no phoning home. */
  async configure(): Promise<void> {
    const set = (key: string, value: unknown) => this.asService(`/api/setting/${key}`, { method: "PUT", body: { value } });
    await set("site-name", "Synergy Insights");
    await set("enable-embedding-static", true);
    await set("embedding-secret-key", embeddingKey(this.c));
    await set("anon-tracking-enabled", false).catch(() => undefined);
    await set("check-for-updates", false).catch(() => undefined);
  }

  /** The group whose members may query the suite's databases; made once. */
  async analystsGroupId(): Promise<number> {
    if (this.analystsGroup) return this.analystsGroup;
    const groups = await this.asService<{ id: number; name: string }[]>("/api/permissions/group");
    const found = groups.find((g) => g.name === ANALYSTS_GROUP);
    this.analystsGroup = found ? found.id : (await this.asService<{ id: number }>("/api/permissions/group", { body: { name: ANALYSTS_GROUP } })).id;
    return this.analystsGroup;
  }

  async findUser(email: string): Promise<MetabaseUser | null> {
    const r = await this.asService<{ data: MetabaseUser[] } | MetabaseUser[]>(
      `/api/user?query=${encodeURIComponent(email)}&include_deactivated=true`,
    );
    const list = Array.isArray(r) ? r : r.data;
    return list.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  /**
   * The person's Metabase account, made the first time they open Insights. Suite admins
   * (INSIGHTS_ADMIN_EMAILS) are Metabase admins and INSIGHTS_ANALYST_EMAILS join the analysts
   * group. Insights only ever adds: anyone promoted or demoted inside Metabase stays that way,
   * except that a listed admin is made an admin again.
   */
  async ensureUser(email: string, name: string): Promise<MetabaseUser> {
    const admin = isAdmin(this.c, email);
    let u = await this.findUser(email);
    if (!u) {
      u = await this.asService<MetabaseUser>("/api/user", {
        body: { ...splitName(name, email), email, password: personPassword(this.c, email) },
      });
    }
    if (!u.is_active) throw new MetabaseError(403, "Your Insights account has been turned off. Ask an admin to turn it back on in Insights' admin settings.");
    if (admin && !u.is_superuser) {
      u = await this.asService<MetabaseUser>(`/api/user/${u.id}`, { method: "PUT", body: { is_superuser: true } });
    }
    if (!admin && isAnalyst(this.c, email)) {
      const group = await this.analystsGroupId();
      const members = await this.asService<Record<string, { group_id: number }[]>>("/api/permissions/membership");
      if (!(members[String(u.id)] ?? []).some((m) => m.group_id === group)) {
        await this.asService("/api/permissions/membership", { body: { group_id: group, user_id: u.id } });
      }
    }
    return u;
  }

  /**
   * A Metabase session for one person, for the sign-in bridge and for calls Insights makes on
   * their behalf. The password is derived, so it is only reset (which ends their other Metabase
   * sessions) when it no longer works: someone changed it in Metabase, or INSIGHTS_SECRET changed.
   */
  async sessionFor(email: string, name: string, opts: { fresh?: boolean } = {}): Promise<string> {
    const key = email.toLowerCase();
    const cached = this.sessions.get(key);
    if (cached && !opts.fresh && Date.now() - cached.at < 6 * 3600_000) return cached.id;
    const login = () => this.call<{ id: string }>("/api/session", { body: { username: key, password: personPassword(this.c, key) } });
    let s: { id: string };
    try {
      await this.ensureSetup();
      const u = await this.ensureUser(key, name);
      try {
        s = await login();
      } catch (err) {
        if (!(err instanceof MetabaseError) || (err.status !== 401 && err.status !== 400)) throw err;
        await this.asService(`/api/user/${u.id}/password`, { method: "PUT", body: { password: personPassword(this.c, key) } });
        s = await login();
      }
    } catch (err) {
      this.sessions.delete(key);
      throw err;
    }
    this.sessions.set(key, { id: s.id, at: Date.now() });
    return s.id;
  }

  /** Calls the API as one person, so Metabase applies their permissions. */
  async asPerson<T = unknown>(email: string, name: string, path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
    try {
      return await this.call<T>(path, { ...opts, session: await this.sessionFor(email, name) });
    } catch (err) {
      if (!(err instanceof MetabaseError) || err.status !== 401) throw err;
      return this.call<T>(path, { ...opts, session: await this.sessionFor(email, name, { fresh: true }) });
    }
  }

  /** Forgets a cached session (after the bridge finds the browser's session ended). */
  forget(email: string) {
    this.sessions.delete(email.toLowerCase());
  }
}

/**
 * One client per server process, so sessions are reused across requests. Kept on globalThis
 * because Next.js loads instrumentation.ts and the routes as separate module copies.
 */
export function metabase(): Metabase {
  const g = globalThis as { __insightsMetabase?: Metabase };
  return (g.__insightsMetabase ??= new Metabase());
}
