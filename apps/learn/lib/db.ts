import { createDb } from "@synergy/db";

/**
 * Authors (LEARN_AUTHOR_EMAILS, default ADMIN_EMAILS) write courses and assign them. Everyone
 * signed in can take a published course. A course is a list of lessons in order; a lesson can end
 * in a quiz, and passing it (LEARN_PASS_MARK percent, default 70) is what completes the lesson.
 * Finishing every lesson completes the course and unlocks its certificate.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS courses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT 'General',
  minutes     INTEGER NOT NULL DEFAULT 0 CHECK (minutes BETWEEN 0 AND 100000),
  published   BOOLEAN NOT NULL DEFAULT false,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS courses_published_idx ON courses (published, category, title);

CREATE TABLE IF NOT EXISTS lessons (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'video')),
  content     TEXT NOT NULL DEFAULT '',
  video_url   TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  -- [{ "q": "...", "options": ["...", "..."], "answer": 0 }]
  quiz        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lessons_course_idx ON lessons (course_id, position);

CREATE TABLE IF NOT EXISTS enrollments (
  course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  due_day     DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, email)
);
CREATE INDEX IF NOT EXISTS enrollments_email_idx ON enrollments (email);

CREATE TABLE IF NOT EXISTS progress (
  lesson_id    UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  course_id    UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  quiz_score   INTEGER,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lesson_id, email)
);
CREATE INDEX IF NOT EXISTS progress_email_idx ON progress (email, course_id);
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __learnDb?: Db; __learnReady?: Promise<void> };

export function db(): Db {
  if (!g.__learnDb) g.__learnDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/learn", max: 10 });
  return g.__learnDb;
}

export function ready(): Promise<void> {
  if (!g.__learnReady) {
    g.__learnReady = db().migrate(SCHEMA, "learn").catch((e) => {
      g.__learnReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__learnReady;
}

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  return (await db().q(text, params)).rows as T[];
}

export type Tq = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>;

/** Runs `fn` in one transaction; `tq` queries inside it. */
export async function tx<T>(fn: (tq: Tq) => Promise<T>): Promise<T> {
  await ready();
  const client = await db().pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(async (text, params = []) => (await client.query(text, params as unknown[])).rows);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
