import { record } from "./audit";
import { authInternalUrl } from "./apps";
import type { Me } from "./types";
import { UserError, cleanEmail, text } from "./util";

/**
 * People, from the sign-in service's SCIM API (Bearer ADMIN_SCIM_TOKEN, or DIRECTORY_SCIM_TOKEN
 * which Contacts uses). The sign-in service stays the source of truth; this only lists, adds and
 * blocks or unblocks sign-in. MFA, apps and keys stay in its own console.
 */

export type Person = { id: string; email: string; name: string; active: boolean; created: string | null };
export type Directory = { configured: false } | { configured: true; people: Person[]; total: number; error?: string };

type ScimUser = { id: string; userName: string; active?: boolean; name?: { formatted?: string }; meta?: { created?: string } };

export function scimToken(env: NodeJS.ProcessEnv = process.env): string {
  return env.ADMIN_SCIM_TOKEN || env.DIRECTORY_SCIM_TOKEN || "";
}

function toPerson(u: ScimUser): Person {
  const email = String(u.userName ?? "").toLowerCase();
  const name = u.name?.formatted && u.name.formatted !== u.userName ? u.name.formatted : "";
  return { id: String(u.id), email, name, active: u.active !== false, created: u.meta?.created ?? null };
}

async function scim<T>(path: string, init: RequestInit = {}): Promise<{ status: number; data: T | null }> {
  const token = scimToken();
  if (!token) throw new UserError("Set ADMIN_SCIM_TOKEN to manage people", 409);
  let res: Response;
  try {
    res = await fetch(`${authInternalUrl()}/api/scim/v2${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/scim+json", "Content-Type": "application/scim+json", ...init.headers },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new UserError("The sign-in service didn't answer", 502);
  }
  const data = (await res.json().catch(() => null)) as T | null;
  if (res.status === 401) throw new UserError("The sign-in service refused the SCIM token; mint a new one in its console", 502);
  return { status: res.status, data };
}

const detail = (d: unknown) => (d && typeof d === "object" && "detail" in d ? String((d as { detail: unknown }).detail) : "");

export async function people(search = ""): Promise<Directory> {
  if (!scimToken()) return { configured: false };
  const out: Person[] = [];
  try {
    for (let start = 1; start < 20000; start += 200) {
      const { status, data } = await scim<{ totalResults: number; Resources?: ScimUser[] }>(`/Users?startIndex=${start}&count=200`);
      if (status !== 200 || !data) throw new UserError(`The sign-in service answered ${status}`, 502);
      out.push(...(data.Resources ?? []).map(toPerson));
      if (!data.Resources?.length || start + 200 > data.totalResults) break;
    }
  } catch (e) {
    return { configured: true, people: [], total: 0, error: (e as Error).message };
  }
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const list = words.length ? out.filter((p) => words.every((w) => `${p.name} ${p.email}`.toLowerCase().includes(w))) : out;
  list.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  return { configured: true, people: list, total: out.length };
}

/** Names and emails for the custodian picker; empty without a SCIM token. */
export async function suggest(search: string, limit = 10): Promise<{ email: string; name: string }[]> {
  const s = text(search, 100).toLowerCase();
  if (!s) return [];
  const d = await people(s);
  if (!d.configured) return [];
  return d.people.slice(0, limit).map((p) => ({ email: p.email, name: p.name }));
}

export async function person(id: string): Promise<Person> {
  if (!/^[\w-]{1,64}$/.test(id)) throw new UserError("That person was not found", 404);
  const { status, data } = await scim<ScimUser>(`/Users/${id}`);
  if (status === 404 || !data) throw new UserError("That person was not found", 404);
  if (status !== 200) throw new UserError(`The sign-in service answered ${status}`, 502);
  return toPerson(data);
}

/** The sign-in service's password rule, checked here because its SCIM route takes any password. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 12) return "The password must be at least 12 characters";
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return "The password needs at least one letter and one digit";
  return null;
}

export async function addPerson(me: Me, v: { email?: unknown; name?: unknown; password?: unknown; active?: unknown }): Promise<Person> {
  const email = cleanEmail(v.email);
  const name = text(v.name, 200);
  const password = typeof v.password === "string" ? v.password : "";
  if (password) {
    const p = passwordProblem(password);
    if (p) throw new UserError(p);
  }
  const active = v.active !== false;
  const body: Record<string, unknown> = {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    userName: email,
    emails: [{ value: email, primary: true }],
    active,
  };
  if (name) body.name = { formatted: name };
  if (password) body.password = password;
  const { status, data } = await scim<ScimUser>(`/Users`, { method: "POST", body: JSON.stringify(body) });
  if (status === 409) throw new UserError("Someone with that email already has an account", 409);
  if (status !== 201 || !data) throw new UserError(detail(data) || `The sign-in service answered ${status}`, 502);
  await record(me.email, "user.create", email, { name, active, initialPassword: !!password });
  return toPerson(data);
}

/** Blocks or unblocks sign-in. Blocking also ends the person's sessions in the sign-in service. */
export async function setActive(me: Me, id: string, active: boolean): Promise<Person> {
  const cur = await person(id);
  if (!active && cur.email === me.email) throw new UserError("You can't block your own sign-in");
  const { status, data } = await scim<ScimUser>(`/Users/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "replace", value: { active } }] }),
  });
  if (status !== 200 || !data) throw new UserError(detail(data) || `The sign-in service answered ${status}`, 502);
  await record(me.email, active ? "user.unblock" : "user.block", cur.email, { id });
  return toPerson(data);
}
