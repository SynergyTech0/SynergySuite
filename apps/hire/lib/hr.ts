import apps from "@synergy/config/apps.json";
import type { Me } from "./api";
import { q } from "./db";
import { candidateFor } from "./hire";
import { UserError, cleanEmail, day, text } from "./util";

/**
 * A hired candidate is added to HR through HR's own API, as the person pressing the button: Hire
 * sends the gateway headers HR already trusts (X-Auth-Request-Email plus X-Proxy-Auth-Secret), so
 * HR's rule that only HR admins add people applies unchanged and HR keeps the record.
 */

function overrides(env: NodeJS.ProcessEnv): Record<string, string> {
  try {
    const v = JSON.parse(env.HIRE_APP_URLS || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Where Hire reaches an app: HIRE_APP_URLS, else http://<id>:<port> in production, localhost otherwise. */
export function internalUrl(id: string, env: NodeJS.ProcessEnv = process.env): string {
  const o = overrides(env)[id];
  if (typeof o === "string" && o) return o.replace(/\/+$/, "");
  const app = apps.find((a) => a.id === id);
  if (!app) throw new Error(`unknown suite app "${id}"`);
  return env.NODE_ENV === "production" ? `http://${app.id}:${app.port}` : `http://localhost:${app.port}`;
}

/** The address people open an app at. */
export function publicUrl(id: string, env: NodeJS.ProcessEnv = process.env): string {
  const app = apps.find((a) => a.id === id);
  if (!app) throw new Error(`unknown suite app "${id}"`);
  return env.SUITE_DOMAIN ? `https://${id}.${env.SUITE_DOMAIN}` : `http://localhost:${app.port}`;
}

/** HR's link to a person's record. */
export function hrRecordUrl(personId: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${publicUrl("hr", env)}/?person=${encodeURIComponent(personId)}`;
}

const HR_TYPES: Record<string, string> = {
  full_time: "full_time", part_time: "part_time", contract: "contractor", temporary: "temporary", internship: "intern",
};

type Fetch = typeof fetch;

/**
 * Adds a hired candidate to HR. The form can change the work email (it starts as the address they
 * applied with), title, department, location, manager and start date; the rest comes from the job.
 */
export async function addToHr(me: Me, id: string, b: Record<string, unknown>, f: Fetch = fetch): Promise<{ personId: string; url: string }> {
  const { c, job } = await candidateFor(me, id);
  if (c.stage !== "hired") throw new UserError("Move the candidate to Hired first");
  if (c.hr_person_id) throw new UserError("Already added to HR", 409);
  const email = cleanEmail(text(b.email) || c.email, "a work email");
  const payload = {
    email,
    name: text(b.name, 160) || c.name,
    title: "title" in b ? text(b.title, 160) : job.title,
    department: "department" in b ? text(b.department, 120) : job.department,
    location: "location" in b ? text(b.location, 160) : job.location,
    managerEmail: text(b.managerEmail) ? cleanEmail(b.managerEmail, "the manager's email") : job.hiring_manager || undefined,
    employmentType: HR_TYPES[job.employment_type] ?? "full_time",
    startDate: day(b.startDate, "Start date") ?? undefined,
    phone: c.phone || undefined,
    personalEmail: email !== c.email ? c.email : undefined,
  };
  let res: Response;
  try {
    res = await f(`${internalUrl("hr")}/api/employees`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-auth-request-email": me.email,
        "x-auth-request-preferred-username": me.name,
        "x-proxy-auth-secret": process.env.PROXY_SHARED_SECRET || "",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new UserError("HR couldn't be reached. Try again in a moment.", 502);
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string | number; error?: string };
  if (!res.ok) throw new UserError(data.error ? `HR said: ${data.error}` : `HR answered ${res.status}`, res.status === 403 || res.status === 409 ? res.status : 502);
  if (data.id === undefined || data.id === null) throw new UserError("HR didn't say which record it made", 502);
  const personId = String(data.id);
  await q(`UPDATE candidates SET hr_person_id = $2, hr_added_at = now(), modified_at = now() WHERE id = $1`, [id, personId]);
  await q(`INSERT INTO candidate_events (candidate_id, kind, body, author) VALUES ($1, 'system', $2, $3)`, [id, `Added to HR as ${email}`, me.email]);
  return { personId, url: hrRecordUrl(personId) };
}
