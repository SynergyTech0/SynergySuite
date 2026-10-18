import type { Me } from "./api";
import { q, tx } from "./db";
import { UserError, cleanEmail, day, emailList, link, text, uuidish } from "./util";

/** Authors: LEARN_AUTHOR_EMAILS (or the older LEARN_AUTHORS), else the suite's ADMIN_EMAILS. */
export function authors(env: NodeJS.ProcessEnv = process.env): string[] {
  return emailList(env.LEARN_AUTHOR_EMAILS || env.LEARN_AUTHORS || env.ADMIN_EMAILS);
}

export function isAuthor(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return authors(env).includes(email.toLowerCase());
}

/** The quiz score, in percent, that passes a lesson. */
export function passMark(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.LEARN_PASS_MARK);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : 70;
}

function needAuthor(me: Me): void {
  if (!isAuthor(me.email)) throw new UserError("Only course authors can do that", 403);
}

type Body = Record<string, unknown>;

// ---------------------------------------------------------------- courses

export type Course = {
  id: string; title: string; description: string; category: string; minutes: number; published: boolean;
  created_by: string; created_at: Date; modified_at: Date;
};

export type CourseCard = Course & { lesson_count: number; done: number; enrolled: boolean; due_day: string | null; pct: number; complete: boolean };

const COURSE_COLS = `c.id, c.title, c.description, c.category, c.minutes, c.published, c.created_by, c.created_at, c.modified_at`;

function withPct<T extends { lesson_count: number; done: number }>(r: T): T & { pct: number; complete: boolean } {
  return { ...r, pct: r.lesson_count ? Math.round((r.done / r.lesson_count) * 100) : 0, complete: r.lesson_count > 0 && r.done >= r.lesson_count };
}

/** The catalog: published courses, or every course for an author who asks for all. */
export async function listCourses(me: Me, all = false): Promise<CourseCard[]> {
  const rows = await q<Omit<CourseCard, "pct" | "complete">>(
    `SELECT ${COURSE_COLS},
       (SELECT count(*)::int FROM lessons l WHERE l.course_id = c.id) AS lesson_count,
       (SELECT count(*)::int FROM progress p JOIN lessons l ON l.id = p.lesson_id WHERE l.course_id = c.id AND p.email = $1) AS done,
       e.email IS NOT NULL AS enrolled, to_char(e.due_day, 'YYYY-MM-DD') AS due_day
     FROM courses c LEFT JOIN enrollments e ON e.course_id = c.id AND e.email = $1
     WHERE c.published OR $2::boolean
     ORDER BY c.category, c.title`,
    [me.email.toLowerCase(), all && isAuthor(me.email)],
  );
  return rows.map(withPct);
}

/** The course, if this person may open it: published ones for everyone, all of them for authors. */
export async function courseFor(me: Me, id: string): Promise<Course> {
  if (!uuidish(id)) throw new UserError("Not found", 404);
  const [c] = await q<Course>(`SELECT ${COURSE_COLS} FROM courses c WHERE c.id = $1`, [id]);
  if (!c || (!c.published && !isAuthor(me.email))) throw new UserError("Not found", 404);
  return c;
}

export type QuizQuestion = { q: string; options: string[]; answer?: number };

export type LessonView = {
  id: string; title: string; kind: string; content: string; video_url: string; position: number;
  quiz: QuizQuestion[]; done: boolean; quiz_score: number | null;
};

/**
 * A course with its lessons and this person's progress. Quiz answers are left out for learners, so
 * they can't be read from the page; authors get them to edit.
 */
export async function getCourse(me: Me, id: string) {
  const c = await courseFor(me, id);
  const author = isAuthor(me.email);
  const email = me.email.toLowerCase();
  const lessons = await q<{ id: string; title: string; kind: string; content: string; video_url: string; position: number; quiz: QuizQuestion[]; done: boolean; quiz_score: number | null }>(
    `SELECT l.id, l.title, l.kind, l.content, l.video_url, l.position, l.quiz, p.lesson_id IS NOT NULL AS done, p.quiz_score
     FROM lessons l LEFT JOIN progress p ON p.lesson_id = l.id AND p.email = $2
     WHERE l.course_id = $1 ORDER BY l.position, l.created_at`,
    [id, email],
  );
  const [e] = await q<{ assigned_by: string; due_day: string | null }>(
    `SELECT assigned_by, to_char(due_day, 'YYYY-MM-DD') AS due_day FROM enrollments WHERE course_id = $1 AND email = $2`,
    [id, email],
  );
  const shaped: LessonView[] = lessons.map((l) => ({
    ...l,
    quiz: (Array.isArray(l.quiz) ? l.quiz : []).map((x) => (author ? x : { q: x.q, options: x.options })),
  }));
  return {
    ...c,
    lessons: shaped,
    enrolled: !!e,
    assigned_by: e?.assigned_by ?? null,
    due_day: e?.due_day ?? null,
    complete: shaped.length > 0 && shaped.every((l) => l.done),
    author,
    passMark: passMark(),
  };
}

export async function saveCourse(me: Me, id: string | null, b: Body): Promise<Course> {
  needAuthor(me);
  const cur = id ? await courseFor(me, id) : null;
  const pick = <T>(key: string, read: (v: unknown) => T, fallback: T): T => (key in b ? read(b[key]) : fallback);
  const f = {
    title: pick("title", (v) => text(v, 200), cur?.title ?? ""),
    description: pick("description", (v) => text(v, 5000), cur?.description ?? ""),
    category: pick("category", (v) => text(v, 80) || "General", cur?.category ?? "General"),
    minutes: pick("minutes", (v) => {
      const n = Number(v || 0);
      if (!Number.isInteger(n) || n < 0 || n > 100000) throw new UserError("Length must be a whole number of minutes");
      return n;
    }, cur?.minutes ?? 0),
    published: pick("published", (v) => v === true, cur?.published ?? false),
  };
  if (!f.title) throw new UserError("Give the course a title");
  if (!cur) {
    const [row] = await q<Course>(
      `INSERT INTO courses AS c (title, description, category, minutes, published, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COURSE_COLS}`,
      [f.title, f.description, f.category, f.minutes, f.published, me.email],
    );
    return row;
  }
  const [row] = await q<Course>(
    `UPDATE courses c SET title = $2, description = $3, category = $4, minutes = $5, published = $6, modified_at = now()
     WHERE c.id = $1 RETURNING ${COURSE_COLS}`,
    [cur.id, f.title, f.description, f.category, f.minutes, f.published],
  );
  return row;
}

export async function deleteCourse(me: Me, id: string): Promise<void> {
  needAuthor(me);
  await courseFor(me, id);
  await q(`DELETE FROM courses WHERE id = $1`, [id]);
}

// ---------------------------------------------------------------- lessons

/** Keeps the questions that have a question and at least two answers; the right answer must be one of them. */
export function normalizeQuiz(v: unknown): QuizQuestion[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new UserError("The quiz must be a list of questions");
  const out: QuizQuestion[] = [];
  for (const raw of v.slice(0, 50)) {
    const x = (raw ?? {}) as Record<string, unknown>;
    const question = text(x.q, 1000);
    const options = Array.isArray(x.options) ? x.options.map((o) => text(o, 500)).filter(Boolean).slice(0, 10) : [];
    if (!question && !options.length) continue;
    if (!question) throw new UserError("Every quiz question needs a question");
    if (options.length < 2) throw new UserError(`"${question}" needs at least two answers`);
    const answer = Number(x.answer);
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) throw new UserError(`Pick the right answer for "${question}"`);
    out.push({ q: question, options, answer });
  }
  return out;
}

async function lessonRow(id: string) {
  if (!uuidish(id)) throw new UserError("Not found", 404);
  const [l] = await q<{ id: string; course_id: string; quiz: QuizQuestion[]; title: string }>(
    `SELECT id, course_id, quiz, title FROM lessons WHERE id = $1`,
    [id],
  );
  if (!l) throw new UserError("Not found", 404);
  return l;
}

function lessonFields(b: Body, cur?: { title: string; kind: string; content: string; video_url: string; quiz: QuizQuestion[] }) {
  const title = "title" in b ? text(b.title, 200) : cur?.title ?? "";
  if (!title) throw new UserError("Give the lesson a title");
  const kind = "kind" in b ? (b.kind === "video" ? "video" : "text") : cur?.kind ?? "text";
  const video_url = "videoUrl" in b ? link(b.videoUrl, "Video link") : cur?.video_url ?? "";
  if (kind === "video" && !video_url) throw new UserError("Add the video's link");
  return {
    title,
    kind,
    content: "content" in b ? text(b.content, 100000) : cur?.content ?? "",
    video_url,
    quiz: "quiz" in b ? normalizeQuiz(b.quiz) : cur?.quiz ?? [],
  };
}

export async function addLesson(me: Me, courseId: string, b: Body) {
  needAuthor(me);
  await courseFor(me, courseId);
  const f = lessonFields(b);
  const [row] = await q<{ id: string }>(
    `INSERT INTO lessons (course_id, title, kind, content, video_url, quiz, position)
     VALUES ($1, $2, $3, $4, $5, $6, (SELECT COALESCE(max(position), -1) + 1 FROM lessons WHERE course_id = $1)) RETURNING id`,
    [courseId, f.title, f.kind, f.content, f.video_url, JSON.stringify(f.quiz)],
  );
  await q(`UPDATE courses SET modified_at = now() WHERE id = $1`, [courseId]);
  return row;
}

export async function updateLesson(me: Me, id: string, b: Body) {
  needAuthor(me);
  const l = await lessonRow(id);
  const [cur] = await q<{ title: string; kind: string; content: string; video_url: string; quiz: QuizQuestion[] }>(
    `SELECT title, kind, content, video_url, quiz FROM lessons WHERE id = $1`,
    [id],
  );
  const f = lessonFields(b, cur);
  await q(
    `UPDATE lessons SET title = $2, kind = $3, content = $4, video_url = $5, quiz = $6, modified_at = now() WHERE id = $1`,
    [id, f.title, f.kind, f.content, f.video_url, JSON.stringify(f.quiz)],
  );
  await q(`UPDATE courses SET modified_at = now() WHERE id = $1`, [l.course_id]);
  return { id };
}

/** Moves a lesson one place up or down. */
export async function moveLesson(me: Me, id: string, dir: "up" | "down") {
  needAuthor(me);
  const l = await lessonRow(id);
  await tx(async (tq) => {
    const ids = (await tq<{ id: string }>(`SELECT id FROM lessons WHERE course_id = $1 ORDER BY position, created_at FOR UPDATE`, [l.course_id])).map((r) => r.id);
    const i = ids.indexOf(id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await tq(`UPDATE lessons l SET position = o.n - 1 FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, n) WHERE l.id = o.id`, [ids]);
  });
  return { ok: true };
}

export async function deleteLesson(me: Me, id: string) {
  needAuthor(me);
  await lessonRow(id);
  await q(`DELETE FROM lessons WHERE id = $1`, [id]);
}

// ---------------------------------------------------------------- taking courses

/**
 * Enrols the person in a course, or (authors) assigns it to others with an optional due date.
 * Assigning again changes the due date.
 */
export async function enroll(me: Me, courseId: string, b: Body): Promise<{ enrolled: string[] }> {
  const c = await courseFor(me, courseId);
  const raw = Array.isArray(b.emails) ? b.emails : typeof b.emails === "string" ? b.emails.split(/[,;\s]+/) : [];
  const emails = [...new Set(raw.map((v) => text(v, 254)).filter(Boolean).map((v) => cleanEmail(v)))];
  const self = me.email.toLowerCase();
  const others = emails.filter((e) => e !== self);
  if (others.length) needAuthor(me);
  if (!c.published && !others.length) throw new UserError("This course isn't published yet");
  const due = day(b.dueDay, "Due date");
  if (due && !others.length) throw new UserError("Only course authors set due dates", 403);
  const who = emails.length ? emails : [self];
  if (who.length > 500) throw new UserError("Assign at most 500 people at a time");
  await q(
    `INSERT INTO enrollments (course_id, email, assigned_by, due_day) SELECT $1, unnest($2::text[]), $3, $4::date
     ON CONFLICT (course_id, email) DO UPDATE SET due_day = COALESCE(EXCLUDED.due_day, enrollments.due_day)`,
    [courseId, who, self, due],
  );
  return { enrolled: who };
}

/** Leaves a course you enrolled yourself in; authors can remove anyone. Progress is kept. */
export async function unenroll(me: Me, courseId: string, b: Body): Promise<void> {
  await courseFor(me, courseId);
  const self = me.email.toLowerCase();
  const email = text(b.email) ? cleanEmail(b.email) : self;
  const [e] = await q<{ assigned_by: string }>(`SELECT assigned_by FROM enrollments WHERE course_id = $1 AND email = $2`, [courseId, email]);
  if (!e) return;
  if (!isAuthor(me.email) && (email !== self || e.assigned_by !== self)) {
    throw new UserError(email === self ? "This course was assigned to you, so only an author can remove it" : "Only course authors can do that", 403);
  }
  await q(`DELETE FROM enrollments WHERE course_id = $1 AND email = $2`, [courseId, email]);
}

/**
 * Finishes a lesson. A lesson with a quiz is graded first and only a pass completes it; the
 * answers are never sent back, only the score. The first lesson finished enrols the person.
 */
export async function completeLesson(me: Me, lessonId: string, b: Body) {
  const l = await lessonRow(lessonId);
  await courseFor(me, l.course_id); // an unpublished course can't be taken
  const quiz = Array.isArray(l.quiz) ? l.quiz : [];
  const mark = passMark();
  let score: number | null = null;
  if (quiz.length) {
    const answers = Array.isArray(b.answers) ? b.answers : [];
    const correct = quiz.reduce((n, x, i) => n + (Number(answers[i]) === x.answer ? 1 : 0), 0);
    score = Math.round((correct / quiz.length) * 100);
    if (score < mark) return { passed: false, score, passMark: mark, courseComplete: false };
  }
  const email = me.email.toLowerCase();
  const remaining = await tx(async (tq) => {
    await tq(
      `INSERT INTO enrollments (course_id, email, assigned_by) VALUES ($1, $2, $2) ON CONFLICT (course_id, email) DO NOTHING`,
      [l.course_id, email],
    );
    await tq(
      `INSERT INTO progress (lesson_id, course_id, email, quiz_score) VALUES ($1, $2, $3, $4)
       ON CONFLICT (lesson_id, email) DO UPDATE SET quiz_score = GREATEST(progress.quiz_score, EXCLUDED.quiz_score), completed_at = now()`,
      [lessonId, l.course_id, email, score],
    );
    const [r] = await tq<{ n: number }>(
      `SELECT count(*)::int AS n FROM lessons l LEFT JOIN progress p ON p.lesson_id = l.id AND p.email = $2
       WHERE l.course_id = $1 AND p.lesson_id IS NULL`,
      [l.course_id, email],
    );
    return r.n;
  });
  return { passed: true, score, passMark: mark, courseComplete: remaining === 0 };
}

export type MyCourse = {
  id: string; title: string; category: string; minutes: number; lesson_count: number; done: number;
  assigned_by: string; due_day: string | null; enrolled_at: Date; last_activity: Date | null; pct: number; complete: boolean; overdue: boolean;
};

/** The courses someone is enrolled in, with how far along they are. */
export async function myLearning(me: Me, today = new Date().toISOString().slice(0, 10)): Promise<MyCourse[]> {
  const rows = await q<Omit<MyCourse, "pct" | "complete" | "overdue">>(
    `SELECT c.id, c.title, c.category, c.minutes,
       (SELECT count(*)::int FROM lessons l WHERE l.course_id = c.id) AS lesson_count,
       (SELECT count(*)::int FROM progress p JOIN lessons l ON l.id = p.lesson_id WHERE l.course_id = c.id AND p.email = e.email) AS done,
       (SELECT max(p.completed_at) FROM progress p WHERE p.course_id = c.id AND p.email = e.email) AS last_activity,
       e.assigned_by, to_char(e.due_day, 'YYYY-MM-DD') AS due_day, e.created_at AS enrolled_at
     FROM enrollments e JOIN courses c ON c.id = e.course_id
     WHERE e.email = $1 AND (c.published OR $2::boolean)
     ORDER BY e.due_day NULLS LAST, e.created_at DESC`,
    [me.email.toLowerCase(), isAuthor(me.email)],
  );
  return rows.map((r) => {
    const x = withPct(r);
    return { ...x, overdue: !x.complete && !!x.due_day && x.due_day < today };
  });
}

export async function dashboard(me: Me) {
  const mine = await myLearning(me);
  const [{ n }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM courses WHERE published`);
  return {
    published: n,
    enrolled: mine.length,
    completed: mine.filter((c) => c.complete).length,
    overdue: mine.filter((c) => c.overdue).length,
  };
}

/** Who is enrolled in a course and how far each has got. Authors only. */
export async function roster(me: Me, courseId: string, today = new Date().toISOString().slice(0, 10)) {
  needAuthor(me);
  await courseFor(me, courseId);
  const [{ n: lessonCount }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM lessons WHERE course_id = $1`, [courseId]);
  const rows = await q<{ email: string; assigned_by: string; due_day: string | null; created_at: Date; done: number; last_activity: Date | null }>(
    `SELECT e.email, e.assigned_by, to_char(e.due_day, 'YYYY-MM-DD') AS due_day, e.created_at,
       (SELECT count(*)::int FROM progress p JOIN lessons l ON l.id = p.lesson_id WHERE l.course_id = e.course_id AND p.email = e.email) AS done,
       (SELECT max(p.completed_at) FROM progress p WHERE p.course_id = e.course_id AND p.email = e.email) AS last_activity
     FROM enrollments e WHERE e.course_id = $1 ORDER BY e.email`,
    [courseId],
  );
  return {
    lessonCount,
    roster: rows.map((r) => {
      const x = withPct({ ...r, lesson_count: lessonCount });
      return { ...x, overdue: !x.complete && !!x.due_day && x.due_day < today };
    }),
  };
}

/** What a certificate shows. Only once every lesson is done. */
export async function certificate(me: Me, courseId: string) {
  const c = await courseFor(me, courseId);
  const email = me.email.toLowerCase();
  const [r] = await q<{ lessons: number; done: number; last: Date | null }>(
    `SELECT count(l.id)::int AS lessons, count(p.lesson_id)::int AS done, max(p.completed_at) AS last
     FROM lessons l LEFT JOIN progress p ON p.lesson_id = l.id AND p.email = $2 WHERE l.course_id = $1`,
    [courseId, email],
  );
  if (!r.lessons || r.done < r.lessons) throw new UserError("Finish every lesson to get the certificate", 403);
  return { course: c.title, category: c.category, learner: me.name || me.email, email, completedAt: r.last, lessons: r.lessons };
}
