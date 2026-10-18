import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.HIRE_ADMIN_EMAILS = "rita@example.com";
process.env.HIRE_COMPANY_NAME = "Example Co";
process.env.PROXY_SHARED_SECRET = "proxy-secret";

const rita = { email: "rita@example.com", name: "Rita", subject: "r" }; // recruiter
const mo = { email: "mo@example.com", name: "Mo", subject: "m" }; // hiring manager
const dan = { email: "dan@example.com", name: "Dan", subject: "d" }; // nobody

describe.skipIf(!url)("hire", async () => {
  const h = await import("../lib/hire");
  const { addToHr } = await import("../lib/hr");
  const { searchFor } = await import("../lib/search");
  const { q, db } = await import("../lib/db");

  beforeAll(async () => {
    await q("SELECT 1");
    await q("TRUNCATE jobs, candidates, candidate_events, careers_settings CASCADE");
  });
  afterAll(async () => {
    await db().close();
  });

  let jobId = "";
  let slug = "";

  it("lets only recruiters make jobs, with a public link that stays put", async () => {
    await expect(h.saveJob(mo, null, { title: "Designer" })).rejects.toThrow(/recruiters/);
    await expect(h.saveJob(rita, null, { title: "" })).rejects.toThrow(/title/);
    const job = await h.saveJob(rita, null, {
      title: "Product Designer", department: "Design", location: "Leeds", employmentType: "full_time", hiringManager: "Mo@Example.com",
    });
    jobId = job.id;
    slug = job.slug;
    expect(slug).toBe("product-designer");
    expect(job.status).toBe("draft");
    expect(job.hiring_manager).toBe("mo@example.com");
    const twin = await h.saveJob(rita, null, { title: "Product Designer" });
    expect(twin.slug).toBe("product-designer-2");
    const renamed = await h.saveJob(rita, twin.id, { title: "Senior Product Designer" });
    expect(renamed.slug).toBe("product-designer-2");
    await h.deleteJob(rita, twin.id);
  });

  it("shows a job only to recruiters and its hiring manager", async () => {
    expect((await h.listJobs(rita)).map((j) => j.id)).toEqual([jobId]);
    expect((await h.listJobs(mo)).map((j) => j.id)).toEqual([jobId]);
    expect(await h.listJobs(dan)).toEqual([]);
    await expect(h.jobFor(dan, jobId)).rejects.toThrow(/Not found/);
    await expect(h.saveJob(mo, jobId, { title: "x" })).rejects.toThrow(/recruiters/);
  });

  it("keeps drafts off the careers page and takes applications for open jobs", async () => {
    expect(await h.publicJobs()).toEqual([]);
    await expect(h.apply(slug, { name: "Ann", email: "ann@example.org" })).rejects.toThrow(/no longer open/);
    const opened = await h.saveJob(rita, jobId, { status: "open" });
    expect(opened.opened_at).not.toBeNull();
    const pub = await h.publicJobs();
    expect(pub.map((j) => j.slug)).toEqual([slug]);
    expect(Object.keys(pub[0])).not.toContain("hiring_manager");

    await expect(h.apply(slug, { name: "Ann", email: "not-an-email" })).rejects.toThrow(/email/);
    await expect(h.apply(slug, { name: "Ann", email: "ann@example.org", resumeUrl: "javascript:alert(1)" })).rejects.toThrow(/https/);
    await h.apply(slug, { name: "Ann Lee", email: "Ann@Example.org", resumeUrl: "https://files.example.org/ann.pdf", coverNote: "I love design." });
    // Applying again says it worked but keeps the first application.
    await h.apply(slug, { name: "Ann Again", email: "ann@example.org" });
    // A bot that fills the hidden field is told it worked and dropped.
    await h.apply(slug, { name: "Bot", email: "bot@example.org", website: "http://spam.test" });
    const list = await h.listCandidates(rita, jobId);
    expect(list.map((c) => [c.name, c.email, c.source, c.stage])).toEqual([["Ann Lee", "ann@example.org", "careers", "applied"]]);
  });

  it("moves candidates through the pipeline and keeps the timeline", async () => {
    const [ann] = await h.listCandidates(mo, jobId);
    await expect(h.updateCandidate(mo, ann.id, { stage: "nope" })).rejects.toThrow(/stage/);
    await expect(h.updateCandidate(mo, ann.id, { rating: 6 })).rejects.toThrow(/0 to 5/);
    await h.updateCandidate(mo, ann.id, { stage: "interview", note: "Strong portfolio" });
    await h.updateCandidate(mo, ann.id, { rating: 4 });
    await h.addNote(mo, ann.id, { body: "Great first interview." });
    await expect(h.addNote(mo, ann.id, { body: "  " })).rejects.toThrow(/note/);
    await expect(h.getCandidate(dan, ann.id)).rejects.toThrow(/Not found/);
    const d = await h.getCandidate(rita, ann.id);
    expect(d.stage).toBe("interview");
    expect(d.rating).toBe(4);
    expect(d.events.map((e) => e.body)).toEqual([
      "Great first interview.",
      "Rated 4 of 5",
      "Moved from Applied to Interview: Strong portfolio",
      "Applied on the careers page",
    ]);
    const dup = h.addCandidate(rita, jobId, { name: "Ann", email: "ann@example.org" });
    await expect(dup).rejects.toThrow(/already a candidate/);
    const ref = await h.addCandidate(mo, jobId, { name: "Raj", email: "raj@example.org", source: "referral" });
    expect(ref.source).toBe("referral");
    await expect(h.deleteCandidate(mo, ref.id)).rejects.toThrow(/recruiters/);
    await h.deleteCandidate(rita, ref.id);
    const [job] = await h.listJobs(rita);
    expect(job.counts).toEqual({ interview: 1 });
    expect(job.total).toBe(1);
  });

  it("adds a hired candidate to HR as the person asking", async () => {
    const [ann] = await h.listCandidates(rita, jobId);
    const calls: { url: string; init: RequestInit }[] = [];
    const hrOk = (async (u: string, init: RequestInit) => {
      calls.push({ url: u, init });
      return new Response(JSON.stringify({ id: "42" }), { status: 201 });
    }) as unknown as typeof fetch;
    await expect(addToHr(rita, ann.id, {}, hrOk)).rejects.toThrow(/Hired first/);
    await h.updateCandidate(rita, ann.id, { stage: "hired" });

    const refused = (async () => new Response(JSON.stringify({ error: "Only HR admins can add people" }), { status: 403 })) as unknown as typeof fetch;
    await expect(addToHr(mo, ann.id, {}, refused)).rejects.toThrow(/HR said: Only HR admins/);

    const out = await addToHr(rita, ann.id, { email: "ann.lee@company.test", startDate: "2026-12-01" }, hrOk);
    expect(out.personId).toBe("42");
    expect(out.url).toMatch(/\/\?person=42$/);
    expect(calls[0].url).toMatch(/\/api\/employees$/);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-auth-request-email"]).toBe("rita@example.com");
    expect(headers["x-proxy-auth-secret"]).toBe("proxy-secret");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      email: "ann.lee@company.test", name: "Ann Lee", title: "Product Designer", department: "Design", location: "Leeds",
      managerEmail: "mo@example.com", employmentType: "full_time", startDate: "2026-12-01", personalEmail: "ann@example.org",
    });
    await expect(addToHr(rita, ann.id, {}, hrOk)).rejects.toThrow(/Already added/);
    const d = await h.getCandidate(rita, ann.id);
    expect(d.hr_person_id).toBe("42");
  });

  it("keeps the careers page text in settings, falling back to the configured name", async () => {
    expect(await h.careersSettings()).toEqual({ company: "Example Co", intro: "", contact: "" });
    await expect(h.saveCareersSettings(mo, { company: "x" })).rejects.toThrow(/recruiters/);
    await expect(h.saveCareersSettings(rita, { contact: "nope" })).rejects.toThrow(/email/);
    await h.saveCareersSettings(rita, { company: "Acme", intro: "Come build with us.", contact: "Jobs@Acme.test" });
    expect(await h.careersSettings()).toEqual({ company: "Acme", intro: "Come build with us.", contact: "jobs@acme.test" });
  });

  it("finds jobs and candidates in suite search for the people who can see them", async () => {
    const mine = await searchFor(mo, { query: "ann" });
    expect(mine.results.map((r) => r.kind)).toEqual(["candidate"]);
    expect((await searchFor(rita, { query: "designer" })).results.map((r) => r.kind)).toEqual(["job"]);
    expect((await searchFor(dan, { query: "ann" })).results).toEqual([]);
    expect((await searchFor(dan, { query: "designer" })).results).toEqual([]);
  });

  it("closing a job takes it off the careers page", async () => {
    const closed = await h.saveJob(rita, jobId, { status: "closed" });
    expect(closed.closed_at).not.toBeNull();
    expect(await h.publicJob(slug)).toBeNull();
    expect(await h.publicJob("../etc")).toBeNull();
  });
});
