/**
 * The Synergy Forms app, asked server to server as the signed-in user (the gateway's identity
 * headers, with the shared secret), so a Base form can be published as a public online form and
 * its responses read back. Nothing in Synergy Forms is changed for this; Base uses its API.
 */
import type { OnlineQuestion } from "./formLayout";
import { HttpError } from "./http";

/** A form as Synergy Forms returns it. */
export type OnlineForm = { id: string; slug: string; title: string; published: boolean };

export type Submission = { id: string; data: Record<string, string>; submittedAt: string };

function internalUrl(): string {
  const url = process.env.FORMS_INTERNAL_URL || (process.env.NODE_ENV === "production" ? "http://forms:3110" : "http://127.0.0.1:3110");
  return url.replace(/\/$/, "");
}

/** Where people fill the form in: forms.<SUITE_DOMAIN>/f/<slug>. */
export function publicUrl(slug: string): string {
  const domain = process.env.SUITE_DOMAIN;
  return `${domain ? `https://forms.${domain}` : "http://localhost:3110"}/f/${encodeURIComponent(slug)}`;
}

const unreachable = () => new HttpError(502, "Synergy Forms isn't reachable right now; try again in a moment");

/** One API call; null for a 404 (the form was deleted in Synergy Forms). */
async function call<T>(email: string, method: string, path: string, body?: unknown): Promise<T | null> {
  const headers: Record<string, string> = { "x-auth-request-email": email, "x-auth-request-user": email };
  if (process.env.PROXY_SHARED_SECRET) headers["x-proxy-auth-secret"] = process.env.PROXY_SHARED_SECRET;
  if (body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${internalUrl()}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw unreachable();
  }
  if (res.status === 404) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 409) throw Object.assign(new HttpError(409, "taken"), { taken: true });
    if (res.status >= 500 || res.status === 401) throw unreachable();
    throw new HttpError(502, `Synergy Forms didn't take the form: ${(data as { error?: string } | null)?.error ?? res.status}`);
  }
  return data as T;
}

const toForm = (r: any): OnlineForm => ({ id: String(r.id), slug: String(r.slug), title: String(r.title), published: !!r.published });

/**
 * Makes a published form. Synergy Forms names a form's address after its title, one form per
 * title, so a taken title gets a number ("Signup (2)").
 */
export async function createOnlineForm(email: string, input: { title: string; description?: string; questions: OnlineQuestion[] }): Promise<OnlineForm> {
  for (let n = 1; n <= 20; n++) {
    const title = n === 1 ? input.title : `${input.title} (${n})`;
    try {
      const made = await call<any>(email, "POST", "/forms", { title, description: input.description ?? "", fields: input.questions });
      if (!made) throw unreachable();
      const published = await call<any>(email, "PATCH", `/forms/${made.id}`, { published: true });
      return toForm(published ?? made);
    } catch (e) {
      if (!(e as { taken?: boolean }).taken) throw e;
    }
  }
  throw new HttpError(409, "Synergy Forms already has forms with that title; rename this form and publish again");
}

/** Changes a form's questions or whether it takes responses; null when it no longer exists. */
export async function updateOnlineForm(email: string, id: string, patch: { title?: string; questions?: OnlineQuestion[]; published?: boolean }): Promise<OnlineForm | null> {
  const r = await call<any>(email, "PATCH", `/forms/${encodeURIComponent(id)}`, { title: patch.title, fields: patch.questions, published: patch.published });
  return r ? toForm(r) : null;
}

/** The newest 1000 responses, oldest first; null when the form no longer exists. */
export async function onlineSubmissions(email: string, id: string): Promise<Submission[] | null> {
  const r = await call<any[]>(email, "GET", `/forms/${encodeURIComponent(id)}/submissions`);
  if (!r) return null;
  return r
    .map((s) => ({ id: String(s.id), data: (s.data ?? {}) as Record<string, string>, submittedAt: new Date(s.submitted_at).toISOString() }))
    .sort((a, b) => Number(a.id) - Number(b.id));
}
