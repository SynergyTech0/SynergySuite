import type { Me } from "./api";
import { q, tx, type Tq } from "./db";
import { UserError, cleanEmail, emailList, isEmail, link, slugify, text, uuidish } from "./util";

export const STAGES = ["applied", "screening", "interview", "offer", "hired", "rejected"] as const;
export type Stage = (typeof STAGES)[number];
export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "temporary", "internship"] as const;
export const JOB_STATUSES = ["draft", "open", "closed"] as const;

export const STAGE_LABELS: Record<Stage, string> = {
  applied: "Applied", screening: "Screening", interview: "Interview", offer: "Offer", hired: "Hired", rejected: "Rejected",
};

/** Recruiters: HIRE_ADMIN_EMAILS, else the suite's ADMIN_EMAILS. They see and run every job. */
export function recruiters(env: NodeJS.ProcessEnv = process.env): string[] {
  return emailList(env.HIRE_ADMIN_EMAILS || env.ADMIN_EMAILS);
}

export function isRecruiter(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return recruiters(env).includes(email.toLowerCase());
}

function needRecruiter(me: Me): void {
  if (!isRecruiter(me.email)) throw new UserError("Only recruiters can do that", 403);
}

// ---------------------------------------------------------------- jobs

export type Job = {
  id: string; slug: string; title: string; department: string; location: string; employment_type: string;
  remote: boolean; salary: string; description: string; status: string; hiring_manager: string;
  created_by: string; created_at: Date; modified_at: Date; opened_at: Date | null; closed_at: Date | null;
};

export type JobSummary = Job & { counts: Record<string, number>; total: number };

const JOB_COLS = `j.id, j.slug, j.title, j.department, j.location, j.employment_type, j.remote, j.salary, j.description,
  j.status, j.hiring_manager, j.created_by, j.created_at, j.modified_at, j.opened_at, j.closed_at`;

/** The job, if this person may see it: recruiters see every job, a hiring manager their own. */
export async function jobFor(me: Me, id: string): Promise<Job> {
  if (!uuidish(id)) throw new UserError("Not found", 404);
  const [job] = await q<Job>(`SELECT ${JOB_COLS} FROM jobs j WHERE j.id = $1`, [id]);
  if (!job || !(isRecruiter(me.email) || job.hiring_manager === me.email.toLowerCase())) throw new UserError("Not found", 404);
  return job;
}

export async function listJobs(me: Me): Promise<JobSummary[]> {
  const all = isRecruiter(me.email);
  const rows = await q<Job & { counts: Record<string, number> | null }>(
    `SELECT ${JOB_COLS},
       (SELECT json_object_agg(stage, n) FROM (SELECT stage, count(*)::int n FROM candidates WHERE job_id = j.id GROUP BY stage) s) AS counts
     FROM jobs j WHERE $1::boolean OR j.hiring_manager = $2
     ORDER BY CASE j.status WHEN 'open' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, j.modified_at DESC`,
    [all, me.email.toLowerCase()],
  );
  return rows.map((r) => {
    const counts = r.counts ?? {};
    return { ...r, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
  });
}

type Body = Record<string, unknown>;

function oneOf<T extends string>(v: unknown, list: readonly T[], what: string): T {
  if (typeof v === "string" && (list as readonly string[]).includes(v)) return v as T;
  throw new UserError(`Pick a ${what}`);
}

/** A slug nobody else has: "designer", then "designer-2" and so on. */
async function freeSlug(tq: Tq, title: string): Promise<string> {
  const base = slugify(title);
  const taken = new Set(
    (await tq<{ slug: string }>(`SELECT slug FROM jobs WHERE slug = $1 OR slug LIKE $2`, [base, `${base}-%`])).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Creates a job (id null) or changes one. Only recruiters. The public link (slug) never changes. */
export async function saveJob(me: Me, id: string | null, b: Body): Promise<Job> {
  needRecruiter(me);
  const current = id ? await jobFor(me, id) : null;
  const pick = <T>(key: string, read: (v: unknown) => T, fallback: T): T => (key in b ? read(b[key]) : fallback);
  const f = {
    title: pick("title", (v) => text(v, 160), current?.title ?? ""),
    department: pick("department", (v) => text(v, 120), current?.department ?? ""),
    location: pick("location", (v) => text(v, 160), current?.location ?? ""),
    employment_type: pick("employmentType", (v) => oneOf(v, EMPLOYMENT_TYPES, "type of job"), current?.employment_type ?? "full_time"),
    remote: pick("remote", (v) => v === true, current?.remote ?? false),
    salary: pick("salary", (v) => text(v, 120), current?.salary ?? ""),
    description: pick("description", (v) => text(v, 20000), current?.description ?? ""),
    status: pick("status", (v) => oneOf(v, JOB_STATUSES, "status"), current?.status ?? "draft"),
    hiring_manager: pick("hiringManager", (v) => (text(v) ? cleanEmail(v, "the hiring manager's email") : ""), current?.hiring_manager ?? ""),
  };
  if (!f.title) throw new UserError("Give the job a title");
  return tx(async (tq) => {
    if (!current) {
      const slug = await freeSlug(tq, f.title);
      const [row] = await tq<{ id: string }>(
        `INSERT INTO jobs (slug, title, department, location, employment_type, remote, salary, description, status, hiring_manager, created_by, opened_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $9 = 'open' THEN now() END) RETURNING id`,
        [slug, f.title, f.department, f.location, f.employment_type, f.remote, f.salary, f.description, f.status, f.hiring_manager, me.email],
      );
      return (await tq<Job>(`SELECT ${JOB_COLS} FROM jobs j WHERE j.id = $1`, [row.id]))[0];
    }
    const [row] = await tq<Job>(
      `UPDATE jobs j SET title = $2, department = $3, location = $4, employment_type = $5, remote = $6, salary = $7, description = $8,
         status = $9, hiring_manager = $10, modified_at = now(),
         opened_at = CASE WHEN $9 = 'open' AND j.status <> 'open' THEN now() ELSE j.opened_at END,
         closed_at = CASE WHEN $9 = 'closed' AND j.status <> 'closed' THEN now() WHEN $9 <> 'closed' THEN NULL ELSE j.closed_at END
       WHERE j.id = $1 RETURNING ${JOB_COLS}`,
      [current.id, f.title, f.department, f.location, f.employment_type, f.remote, f.salary, f.description, f.status, f.hiring_manager],
    );
    return row;
  });
}

export async function deleteJob(me: Me, id: string): Promise<void> {
  needRecruiter(me);
  await jobFor(me, id);
  await q(`DELETE FROM jobs WHERE id = $1`, [id]);
}

// ---------------------------------------------------------------- candidates

export type Candidate = {
  id: string; job_id: string; name: string; email: string; phone: string; profile_url: string; resume_url: string;
  cover_note: string; source: string; stage: Stage; rating: number; stage_changed_at: Date;
  hr_person_id: string | null; hr_added_at: Date | null; created_by: string; created_at: Date; modified_at: Date;
};
export type CandidateEvent = { id: string; kind: string; body: string; author: string; created_at: Date };

const CAND_COLS = `c.id, c.job_id, c.name, c.email, c.phone, c.profile_url, c.resume_url, c.cover_note, c.source, c.stage,
  c.rating, c.stage_changed_at, c.hr_person_id, c.hr_added_at, c.created_by, c.created_at, c.modified_at`;

export async function listCandidates(me: Me, jobId: string): Promise<Candidate[]> {
  await jobFor(me, jobId);
  return q<Candidate>(
    `SELECT ${CAND_COLS} FROM candidates c WHERE c.job_id = $1
     ORDER BY array_position($2::text[], c.stage), c.rating DESC, c.stage_changed_at`,
    [jobId, STAGES],
  );
}

/** The candidate and their job, if this person may see the job. */
export async function candidateFor(me: Me, id: string): Promise<{ c: Candidate; job: Job }> {
  if (!uuidish(id)) throw new UserError("Not found", 404);
  const [c] = await q<Candidate>(`SELECT ${CAND_COLS} FROM candidates c WHERE c.id = $1`, [id]);
  if (!c) throw new UserError("Not found", 404);
  const job = await jobFor(me, c.job_id);
  return { c, job };
}

export async function getCandidate(me: Me, id: string): Promise<Candidate & { job: Pick<Job, "id" | "title" | "department" | "location" | "employment_type" | "hiring_manager">; events: CandidateEvent[] }> {
  const { c, job } = await candidateFor(me, id);
  const events = await q<CandidateEvent>(
    `SELECT id, kind, body, author, created_at FROM candidate_events WHERE candidate_id = $1 ORDER BY created_at DESC, id`,
    [id],
  );
  return {
    ...c,
    job: { id: job.id, title: job.title, department: job.department, location: job.location, employment_type: job.employment_type, hiring_manager: job.hiring_manager },
    events,
  };
}

function person(b: Body) {
  const name = text(b.name, 160);
  if (!name) throw new UserError("Enter the candidate's name");
  return {
    name,
    email: cleanEmail(b.email, "the candidate's email"),
    phone: text(b.phone, 40),
    profile_url: link(b.profileUrl, "Profile link"),
    resume_url: link(b.resumeUrl, "Résumé link"),
    cover_note: text(b.coverNote, 5000),
  };
}

async function logEvent(tq: Tq, candidateId: string, kind: "note" | "stage" | "system", body: string, author: string): Promise<void> {
  await tq(`INSERT INTO candidate_events (candidate_id, kind, body, author) VALUES ($1, $2, $3, $4)`, [candidateId, kind, body, author]);
}

/** A recruiter or the hiring manager adds someone by hand (a referral, a sourced profile). */
export async function addCandidate(me: Me, jobId: string, b: Body): Promise<Candidate> {
  await jobFor(me, jobId);
  const p = person(b);
  const source = b.source === "referral" ? "referral" : "manual";
  return tx(async (tq) => {
    const [row] = await tq<Candidate>(
      `INSERT INTO candidates AS c (job_id, name, email, phone, profile_url, resume_url, cover_note, source, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${CAND_COLS}`,
      [jobId, p.name, p.email, p.phone, p.profile_url, p.resume_url, p.cover_note, source, me.email],
    ).catch((e) => {
      if ((e as { code?: string }).code === "23505") throw new UserError("That person is already a candidate for this job", 409);
      throw e;
    });
    await logEvent(tq, row.id, "system", source === "referral" ? "Added as a referral" : "Added by hand", me.email);
    return row;
  });
}

/**
 * Changes a candidate: stage, rating, or their details. A stage change is kept on the timeline
 * with an optional note saying why.
 */
export async function updateCandidate(me: Me, id: string, b: Body): Promise<Candidate> {
  const { c } = await candidateFor(me, id);
  const stage = "stage" in b ? oneOf(b.stage, STAGES, "stage") : c.stage;
  let rating = c.rating;
  if ("rating" in b) {
    rating = Number(b.rating);
    if (!Number.isInteger(rating) || rating < 0 || rating > 5) throw new UserError("Rating must be 0 to 5 stars");
  }
  const details = ["name", "email", "phone", "profileUrl", "resumeUrl", "coverNote"].some((k) => k in b)
    ? person({ name: c.name, email: c.email, phone: c.phone, profileUrl: c.profile_url, resumeUrl: c.resume_url, coverNote: c.cover_note, ...b })
    : null;
  return tx(async (tq) => {
    const [row] = await tq<Candidate>(
      `UPDATE candidates c SET stage = $2, rating = $3,
         stage_changed_at = CASE WHEN c.stage <> $2 THEN now() ELSE c.stage_changed_at END,
         name = COALESCE($4, c.name), email = COALESCE($5, c.email), phone = COALESCE($6, c.phone),
         profile_url = COALESCE($7, c.profile_url), resume_url = COALESCE($8, c.resume_url), cover_note = COALESCE($9, c.cover_note),
         modified_at = now()
       WHERE c.id = $1 RETURNING ${CAND_COLS}`,
      [id, stage, rating, details?.name ?? null, details?.email ?? null, details?.phone ?? null, details?.profile_url ?? null, details?.resume_url ?? null, details?.cover_note ?? null],
    ).catch((e) => {
      if ((e as { code?: string }).code === "23505") throw new UserError("That person is already a candidate for this job", 409);
      throw e;
    });
    if (stage !== c.stage) {
      const why = text(b.note, 2000);
      await logEvent(tq, id, "stage", `Moved from ${STAGE_LABELS[c.stage]} to ${STAGE_LABELS[stage]}${why ? `: ${why}` : ""}`, me.email);
    }
    if (rating !== c.rating) await logEvent(tq, id, "system", rating ? `Rated ${rating} of 5` : "Rating cleared", me.email);
    return row;
  });
}

export async function addNote(me: Me, id: string, b: Body): Promise<CandidateEvent> {
  await candidateFor(me, id);
  const body = text(b.body, 5000);
  if (!body) throw new UserError("Write a note first");
  const [row] = await q<CandidateEvent>(
    `INSERT INTO candidate_events (candidate_id, kind, body, author) VALUES ($1, 'note', $2, $3) RETURNING id, kind, body, author, created_at`,
    [id, body, me.email],
  );
  await q(`UPDATE candidates SET modified_at = now() WHERE id = $1`, [id]);
  return row;
}

export async function deleteCandidate(me: Me, id: string): Promise<void> {
  needRecruiter(me);
  await candidateFor(me, id);
  await q(`DELETE FROM candidates WHERE id = $1`, [id]);
}

// ---------------------------------------------------------------- the careers page

export type PublicJob = Pick<Job, "slug" | "title" | "department" | "location" | "employment_type" | "remote" | "salary" | "description"> & { opened_at: Date | null };

const PUBLIC_COLS = `slug, title, department, location, employment_type, remote, salary, description, opened_at`;

export async function publicJobs(): Promise<PublicJob[]> {
  return q<PublicJob>(`SELECT ${PUBLIC_COLS} FROM jobs WHERE status = 'open' ORDER BY department, title`);
}

export async function publicJob(slug: string): Promise<PublicJob | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const [job] = await q<PublicJob>(`SELECT ${PUBLIC_COLS} FROM jobs WHERE slug = $1 AND status = 'open'`, [slug]);
  return job ?? null;
}

/**
 * An application from the careers page. The `website` field is a trap for bots: people never see
 * it, so anything in it means the form was filled by a script, which is told it worked and dropped.
 * Applying twice to the same job keeps the first application and still says it worked, so the
 * form never tells a stranger who has applied.
 */
export async function apply(slug: string, b: Body): Promise<{ ok: true }> {
  if (text(b.website)) return { ok: true };
  const job = await publicJob(slug);
  if (!job) throw new UserError("This job is no longer open", 404);
  if (!isEmail(b.email)) throw new UserError("Enter your email address");
  const name = text(b.name, 160);
  if (!name) throw new UserError("Enter your name");
  const p = person({ ...b, name });
  await tx(async (tq) => {
    const [row] = await tq<{ id: string }>(
      `INSERT INTO candidates (job_id, name, email, phone, profile_url, resume_url, cover_note, source)
       SELECT id, $2, $3, $4, $5, $6, $7, 'careers' FROM jobs WHERE slug = $1 AND status = 'open'
       ON CONFLICT (job_id, email) DO NOTHING RETURNING id`,
      [slug, p.name, p.email, p.phone, p.profile_url, p.resume_url, p.cover_note],
    );
    if (row) await logEvent(tq, row.id, "system", "Applied on the careers page", p.email);
  });
  return { ok: true };
}

export type CareersSettings = { company: string; intro: string; contact: string };

/** What the careers page says. Empty fields fall back to HIRE_COMPANY_NAME and nothing else. */
export async function careersSettings(env: NodeJS.ProcessEnv = process.env): Promise<CareersSettings> {
  const [row] = await q<CareersSettings>(`SELECT company, intro, contact FROM careers_settings`);
  return { company: row?.company || text(env.HIRE_COMPANY_NAME, 120), intro: row?.intro ?? "", contact: row?.contact ?? "" };
}

export async function saveCareersSettings(me: Me, b: Body): Promise<CareersSettings> {
  needRecruiter(me);
  const contact = text(b.contact, 254);
  if (contact && !isEmail(contact)) throw new UserError("The contact must be an email address");
  await q(
    `INSERT INTO careers_settings (id, company, intro, contact, modified_by) VALUES (true, $1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET company = $1, intro = $2, contact = $3, modified_by = $4, modified_at = now()`,
    [text(b.company, 120), text(b.intro, 4000), contact.toLowerCase(), me.email],
  );
  return careersSettings();
}
