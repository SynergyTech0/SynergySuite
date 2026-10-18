import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.LEARN_AUTHOR_EMAILS = "ada@example.com";
process.env.LEARN_PASS_MARK = "";

const ada = { email: "ada@example.com", name: "Ada", subject: "a" }; // author
const lin = { email: "lin@example.com", name: "Lin Park", subject: "l" }; // learner
const sam = { email: "sam@example.com", name: "Sam", subject: "s" }; // another learner

describe.skipIf(!url)("learn", async () => {
  const l = await import("../lib/learn");
  const { searchFor } = await import("../lib/search");
  const { q, db } = await import("../lib/db");

  beforeAll(async () => {
    await q("SELECT 1");
    await q("TRUNCATE courses, lessons, enrollments, progress CASCADE");
  });
  afterAll(async () => {
    await db().close();
  });

  let courseId = "";
  let reading = "";
  let quizzed = "";

  it("lets only authors write courses and lessons", async () => {
    await expect(l.saveCourse(lin, null, { title: "Mine" })).rejects.toThrow(/authors/);
    const c = await l.saveCourse(ada, null, { title: "Security basics", category: "Compliance", description: "Phishing and passwords.", minutes: 30 });
    courseId = c.id;
    expect(c.published).toBe(false);
    reading = (await l.addLesson(ada, courseId, { title: "Spotting phishing", content: "Check the sender.\n- Hover links" })).id;
    await expect(l.addLesson(ada, courseId, { title: "Video", kind: "video" })).rejects.toThrow(/video's link/);
    await expect(l.addLesson(ada, courseId, { title: "Bad", kind: "video", videoUrl: "javascript:alert(1)" })).rejects.toThrow(/https/);
    await expect(l.addLesson(ada, courseId, { title: "Quiz", quiz: [{ q: "One?", options: ["a"], answer: 0 }] })).rejects.toThrow(/two answers/);
    await expect(l.addLesson(ada, courseId, { title: "Quiz", quiz: [{ q: "One?", options: ["a", "b"], answer: 5 }] })).rejects.toThrow(/right answer/);
    quizzed = (
      await l.addLesson(ada, courseId, {
        title: "Passwords",
        quiz: [
          { q: "Reuse passwords?", options: ["Yes", "No"], answer: 1 },
          { q: "Best second factor?", options: ["SMS", "Authenticator app", "None"], answer: 1 },
          { q: "Share your password with IT?", options: ["Never", "Always"], answer: 0 },
        ],
      })
    ).id;
    await expect(l.addLesson(lin, courseId, { title: "x" })).rejects.toThrow(/authors/);
  });

  it("hides drafts from learners, including taking their lessons", async () => {
    expect(await l.listCourses(lin)).toEqual([]);
    expect(await l.listCourses(lin, true)).toEqual([]);
    expect((await l.listCourses(ada, true)).map((c) => c.id)).toEqual([courseId]);
    await expect(l.getCourse(lin, courseId)).rejects.toThrow(/Not found/);
    await expect(l.completeLesson(lin, reading, {})).rejects.toThrow(/Not found/);
    await expect(l.enroll(lin, courseId, {})).rejects.toThrow(/Not found/);
    await l.saveCourse(ada, courseId, { published: true });
    expect((await l.listCourses(lin)).map((c) => c.title)).toEqual(["Security basics"]);
  });

  it("never sends quiz answers to learners", async () => {
    const forLin = await l.getCourse(lin, courseId);
    const quiz = forLin.lessons.find((x) => x.id === quizzed)!.quiz;
    expect(quiz).toHaveLength(3);
    expect(quiz.every((x) => !("answer" in x))).toBe(true);
    const forAda = await l.getCourse(ada, courseId);
    expect(forAda.lessons.find((x) => x.id === quizzed)!.quiz[0].answer).toBe(1);
  });

  it("grades quizzes, completes lessons and the course", async () => {
    const r1 = await l.completeLesson(lin, reading, {});
    expect(r1).toMatchObject({ passed: true, score: null, courseComplete: false });
    const mine = await l.myLearning(lin);
    expect(mine.map((c) => [c.title, c.done, c.lesson_count, c.pct, c.assigned_by])).toEqual([["Security basics", 1, 2, 50, "lin@example.com"]]);
    await expect(l.certificate(lin, courseId)).rejects.toThrow(/Finish every lesson/);

    const fail = await l.completeLesson(lin, quizzed, { answers: [1, 0, 1] });
    expect(fail).toMatchObject({ passed: false, score: 33, passMark: 70 });
    expect((await l.getCourse(lin, courseId)).lessons.find((x) => x.id === quizzed)!.done).toBe(false);

    const pass = await l.completeLesson(lin, quizzed, { answers: [1, 1, 0] });
    expect(pass).toMatchObject({ passed: true, score: 100, courseComplete: true });
    const c = await l.getCourse(lin, courseId);
    expect(c.complete).toBe(true);
    const cert = await l.certificate(lin, courseId);
    expect(cert).toMatchObject({ course: "Security basics", learner: "Lin Park", lessons: 2 });
    expect((await l.dashboard(lin)).completed).toBe(1);
  });

  it("lets authors assign courses with due dates and see the roster", async () => {
    await expect(l.enroll(lin, courseId, { emails: ["sam@example.com"] })).rejects.toThrow(/authors/);
    await expect(l.enroll(lin, courseId, { dueDay: "2026-01-01" })).rejects.toThrow(/due dates/);
    const r = await l.enroll(ada, courseId, { emails: "Sam@Example.com, lin@example.com", dueDay: "2026-01-31" });
    expect(r.enrolled).toEqual(["sam@example.com", "lin@example.com"]);
    const samsList = await l.myLearning(sam, "2026-02-01");
    expect(samsList[0]).toMatchObject({ assigned_by: "ada@example.com", due_day: "2026-01-31", overdue: true, pct: 0 });
    // Finished courses are never overdue.
    expect((await l.myLearning(lin, "2026-02-01"))[0].overdue).toBe(false);
    const roster = await l.roster(ada, courseId, "2026-02-01");
    expect(roster.lessonCount).toBe(2);
    expect(roster.roster.map((x) => [x.email, x.pct, x.overdue])).toEqual([["lin@example.com", 100, false], ["sam@example.com", 0, true]]);
    await expect(l.roster(lin, courseId)).rejects.toThrow(/authors/);
  });

  it("lets people leave courses they chose, but not ones assigned to them", async () => {
    await expect(l.unenroll(sam, courseId, {})).rejects.toThrow(/assigned to you/);
    await expect(l.unenroll(sam, courseId, { email: "lin@example.com" })).rejects.toThrow(/authors/);
    await l.unenroll(ada, courseId, { email: "sam@example.com" });
    expect(await l.myLearning(sam)).toEqual([]);
    await l.enroll(sam, courseId, {});
    await l.unenroll(sam, courseId, {});
    expect(await l.myLearning(sam)).toEqual([]);
  });

  it("reorders lessons", async () => {
    await l.moveLesson(ada, quizzed, "up");
    expect((await l.getCourse(ada, courseId)).lessons.map((x) => x.id)).toEqual([quizzed, reading]);
    await l.moveLesson(ada, quizzed, "up");
    expect((await l.getCourse(ada, courseId)).lessons.map((x) => x.id)).toEqual([quizzed, reading]);
    await expect(l.moveLesson(lin, quizzed, "down")).rejects.toThrow(/authors/);
  });

  it("finds published courses and lessons in suite search", async () => {
    expect((await searchFor(lin, { query: "phishing" })).results.map((r) => r.kind).sort()).toEqual(["course", "lesson"]);
    await l.saveCourse(ada, courseId, { published: false });
    expect((await searchFor(lin, { query: "phishing" })).results).toEqual([]);
    expect((await searchFor(ada, { query: "phishing" })).results.length).toBe(2);
    // A course taken off the catalog drops out of My learning too.
    expect(await l.myLearning(lin)).toEqual([]);
  });

  it("deletes a course with its lessons and progress", async () => {
    await expect(l.deleteCourse(lin, courseId)).rejects.toThrow(/authors|Not found/);
    await l.deleteCourse(ada, courseId);
    expect(await q("SELECT 1 FROM progress")).toEqual([]);
  });
});

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe("settings", async () => {
  const l = await import("../lib/learn");
  it("has no built-in authors and a sane pass mark", () => {
    expect(l.authors(env({}))).toEqual([]);
    expect(l.authors(env({ ADMIN_EMAILS: "Boss@x.test" }))).toEqual(["boss@x.test"]);
    expect(l.authors(env({ LEARN_AUTHORS: "old@x.test", ADMIN_EMAILS: "boss@x.test" }))).toEqual(["old@x.test"]);
    expect(l.passMark(env({ LEARN_PASS_MARK: "80" }))).toBe(80);
    expect(l.passMark(env({ LEARN_PASS_MARK: "abc" }))).toBe(70);
    expect(l.normalizeQuiz([{ q: "", options: [] }])).toEqual([]);
  });
});
