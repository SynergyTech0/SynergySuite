"use client";
import { ArrowDown, ArrowUp, Award, BookOpen, Check, GraduationCap, Library, Pencil, Plus, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Confirm, Modal } from "./Modal";
import { Prose } from "./Prose";
import { api, dayText, duration, person, when } from "./client";

type MeInfo = { email: string; name: string; author: boolean; passMark: number };
type CourseCard = {
  id: string; title: string; description: string; category: string; minutes: number; published: boolean;
  lesson_count: number; done: number; enrolled: boolean; due_day: string | null; pct: number; complete: boolean;
};
type MyCourse = {
  id: string; title: string; category: string; minutes: number; lesson_count: number; done: number; assigned_by: string;
  due_day: string | null; pct: number; complete: boolean; overdue: boolean; last_activity: string | null;
};
type Question = { q: string; options: string[]; answer?: number };
type Lesson = { id: string; title: string; kind: string; content: string; video_url: string; position: number; quiz: Question[]; done: boolean; quiz_score: number | null };
type Course = {
  id: string; title: string; description: string; category: string; minutes: number; published: boolean; lessons: Lesson[];
  enrolled: boolean; assigned_by: string | null; due_day: string | null; complete: boolean; author: boolean; passMark: number;
};
type Dashboard = { published: number; enrolled: number; completed: number; overdue: number };

function useParams(): [URLSearchParams, (next: Record<string, string | null>) => void] {
  const [sp, setSp] = useState(() => new URLSearchParams());
  useEffect(() => {
    const read = () => setSp(new URLSearchParams(location.search));
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  const go = useCallback((next: Record<string, string | null>) => {
    const u = new URL(location.href);
    u.search = "";
    for (const [k, v] of Object.entries(next)) if (v) u.searchParams.set(k, v);
    history.pushState(null, "", u);
    setSp(new URLSearchParams(u.search));
  }, []);
  return [sp, go];
}

function Meter({ pct }: { pct: number }) {
  return <div className="meter" aria-label={`${pct}% done`}><div style={{ width: `${pct}%` }} /></div>;
}

export function LearnApp() {
  const [me, setMe] = useState<MeInfo | null>(null);
  const [err, setErr] = useState("");
  const [sp, go] = useParams();
  const [newCourse, setNewCourse] = useState(false);
  useEffect(() => {
    api<MeInfo>("/api/me").then(setMe).catch((e) => setErr(e.message));
  }, []);
  if (err) return <div className="pad error">{err}</div>;
  if (!me) return <div className="pad muted">Loading…</div>;
  const view = sp.get("course") ? "course" : sp.get("view") || "my";
  return (
    <div className="app">
      <nav className="nav">
        {me.author && (
          <button className="btn primary newbtn" onClick={() => setNewCourse(true)}><Plus size={16} /> New course</button>
        )}
        <button className={`navitem${view === "my" ? " active" : ""}`} onClick={() => go({})}><GraduationCap size={16} /> My learning</button>
        <button className={`navitem${view === "catalog" ? " active" : ""}`} onClick={() => go({ view: "catalog" })}><Library size={16} /> Catalog</button>
        {me.author && (
          <button className={`navitem${view === "manage" ? " active" : ""}`} onClick={() => go({ view: "manage" })}><Pencil size={16} /> Manage courses</button>
        )}
      </nav>
      <main className="main">
        {view === "course" ? (
          <CourseView key={sp.get("course")} me={me} id={sp.get("course")!} lessonId={sp.get("lesson")} tab={sp.get("tab")} go={go} />
        ) : view === "catalog" ? (
          <Catalog all={false} open={(id) => go({ course: id })} />
        ) : view === "manage" && me.author ? (
          <Catalog all open={(id) => go({ course: id })} />
        ) : (
          <MyLearning open={(id) => go({ course: id })} browse={() => go({ view: "catalog" })} />
        )}
      </main>
      {newCourse && (
        <CourseEditor
          course={null}
          onClose={() => setNewCourse(false)}
          onSaved={(c) => {
            setNewCourse(false);
            go({ course: c.id });
          }}
        />
      )}
    </div>
  );
}

function MyLearning({ open, browse }: { open: (id: string) => void; browse: () => void }) {
  const [d, setD] = useState<Dashboard | null>(null);
  const [list, setList] = useState<MyCourse[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api<Dashboard>("/api/dashboard").then(setD).catch((e) => setErr(e.message));
    api<MyCourse[]>("/api/my").then(setList).catch((e) => setErr(e.message));
  }, []);
  return (
    <>
      <div className="head"><div className="grow"><h1>My learning</h1><p className="sub muted">Courses you are taking or were assigned.</p></div></div>
      <div className="body">
        <p className="error">{err}</p>
        {d && (
          <div className="kpis">
            <div className="kpi"><span className="muted">In progress</span><b>{d.enrolled - d.completed}</b></div>
            <div className="kpi"><span className="muted">Completed</span><b>{d.completed}</b></div>
            <div className="kpi"><span className="muted">Overdue</span><b>{d.overdue}</b></div>
            <div className="kpi"><span className="muted">Courses available</span><b>{d.published}</b></div>
          </div>
        )}
        {!list ? (
          <p className="muted">Loading…</p>
        ) : list.length === 0 ? (
          <div className="empty">
            <p>You aren&apos;t taking any courses yet.</p>
            <button className="btn primary" onClick={browse}><Library size={16} /> Browse the catalog</button>
          </div>
        ) : (
          <div className="tablewrap">
            <table className="grid">
              <thead><tr><th>Course</th><th>Progress</th><th>Due</th><th>Assigned by</th></tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="click" onClick={() => open(c.id)}>
                    <td><b>{c.title}</b><div className="muted small">{[c.category, duration(c.minutes)].filter(Boolean).join(" · ")}</div></td>
                    <td style={{ minWidth: 160 }}>
                      {c.complete ? <span className="pill done">Completed</span> : <span className="small">{c.done} of {c.lesson_count} lessons</span>}
                      <Meter pct={c.pct} />
                    </td>
                    <td>{c.due_day ? <>{dayText(c.due_day)} {c.overdue && <span className="pill overdue">Overdue</span>}</> : <span className="muted">None</span>}</td>
                    <td>{person(c.assigned_by)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function Catalog({ all, open }: { all: boolean; open: (id: string) => void }) {
  const [list, setList] = useState<CourseCard[] | null>(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("");
  useEffect(() => {
    setList(null);
    api<CourseCard[]>(`/api/courses${all ? "?all=1" : ""}`).then(setList).catch((e) => setErr(e.message));
  }, [all]);
  const shown = (list ?? []).filter((c) => !filter || `${c.title} ${c.category} ${c.description}`.toLowerCase().includes(filter.toLowerCase()));
  const cats = [...new Set(shown.map((c) => c.category))];
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>{all ? "Manage courses" : "Catalog"}</h1>
          <p className="sub muted">{all ? "Every course, published or not." : "Courses anyone here can take."}</p>
        </div>
        <input className="cellin" placeholder="Filter courses" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter courses" />
      </div>
      <div className="body">
        <p className="error">{err}</p>
        {!list ? <p className="muted">Loading…</p> : shown.length === 0 ? <div className="empty">No courses yet.</div> : null}
        {cats.map((cat) => (
          <section key={cat}>
            <h3>{cat}</h3>
            <div className="cards">
              {shown.filter((c) => c.category === cat).map((c) => (
                <button key={c.id} className="ccard" onClick={() => open(c.id)}>
                  <b>{c.title}</b>
                  <span className="muted small">
                    {c.lesson_count} lesson{c.lesson_count === 1 ? "" : "s"}{c.minutes ? ` · ${duration(c.minutes)}` : ""}
                    {all && <span className={`pill ${c.published ? "published" : "draft"}`} style={{ marginLeft: 6 }}>{c.published ? "Published" : "Draft"}</span>}
                  </span>
                  {c.description && <span className="desc">{c.description}</span>}
                  {c.enrolled && (c.complete ? <span className="pill done">Completed</span> : <Meter pct={c.pct} />)}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function CourseView({ me, id, lessonId, tab, go }: {
  me: MeInfo; id: string; lessonId: string | null; tab: string | null; go: (next: Record<string, string | null>) => void;
}) {
  const [c, setC] = useState<Course | null>(null);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);
  const [lessonEdit, setLessonEdit] = useState<Lesson | "new" | null>(null);
  const [del, setDel] = useState(false);
  const load = useCallback(() => api<Course>(`/api/courses/${id}`).then(setC).catch((e) => setErr(e.message)), [id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (err && !c) return <div className="pad error">{err}</div>;
  if (!c) return <div className="pad muted">Loading…</div>;
  const lesson = c.lessons.find((l) => l.id === lessonId) ?? null;
  const done = c.lessons.filter((l) => l.done).length;
  const pct = c.lessons.length ? Math.round((done / c.lessons.length) * 100) : 0;
  const act = async (fn: () => Promise<unknown>) => {
    setErr("");
    try {
      await fn();
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const openLesson = (l: Lesson | null) => go({ course: id, lesson: l?.id ?? null });

  return (
    <div className="course">
      <aside className="outline">
        <button className={`navitem${!lesson && tab !== "people" ? " active" : ""}`} onClick={() => go({ course: id })}>
          <BookOpen size={16} /> <span className="fname">Overview</span>
        </button>
        {c.author && (
          <button className={`navitem${tab === "people" ? " active" : ""}`} onClick={() => go({ course: id, tab: "people" })}>
            <Users size={16} /> <span className="fname">People</span>
          </button>
        )}
        <div className="navsection">Lessons</div>
        {c.lessons.map((l, i) => (
          <button key={l.id} className={`navitem${l.id === lessonId ? " active" : ""}`} onClick={() => openLesson(l)}>
            <span className={`tick${l.done ? " on" : ""}`}>{l.done && <Check size={12} />}</span>
            <span className="grow">{i + 1}. {l.title}</span>
          </button>
        ))}
        {c.author && (
          <button className="navitem" onClick={() => setLessonEdit("new")}><Plus size={16} /> Add lesson</button>
        )}
      </aside>
      <div style={{ minWidth: 0 }}>
        {err && <p className="error pad">{err}</p>}
        {tab === "people" && c.author ? (
          <People course={c} />
        ) : lesson ? (
          <LessonView
            key={lesson.id}
            me={me}
            course={c}
            lesson={lesson}
            onDone={load}
            onNext={() => {
              const i = c.lessons.findIndex((l) => l.id === lesson.id);
              openLesson(c.lessons[i + 1] ?? null);
            }}
            onEdit={() => setLessonEdit(lesson)}
            onMove={(dir) => act(() => api(`/api/lessons/${lesson.id}/move`, { method: "POST", json: { dir } }))}
          />
        ) : (
          <div className="lesson">
            <div>
              <p className="muted small">{c.category}{c.minutes ? ` · ${duration(c.minutes)}` : ""}</p>
              <h1>{c.title} {c.author && <span className={`pill ${c.published ? "published" : "draft"}`}>{c.published ? "Published" : "Draft"}</span>}</h1>
            </div>
            {c.description && <Prose text={c.description} />}
            {c.enrolled && (
              <div>
                <span className="small">{c.complete ? "You finished this course." : `${done} of ${c.lessons.length} lessons done`}</span>
                {c.due_day && !c.complete && <span className="small muted"> · due {dayText(c.due_day)}</span>}
                <Meter pct={pct} />
              </div>
            )}
            <div className="toolbar">
              {c.lessons.length > 0 && (
                <button className="btn primary" onClick={() => openLesson(c.lessons.find((l) => !l.done) ?? c.lessons[0])}>
                  {done ? (c.complete ? "Review lessons" : "Continue") : "Start"}
                </button>
              )}
              {!c.enrolled && c.published && (
                <button className="btn" onClick={() => act(() => api(`/api/courses/${id}/enroll`, { method: "POST", json: {} }))}>Add to my learning</button>
              )}
              {c.enrolled && (c.assigned_by === me.email || c.author) && !c.complete && (
                <button className="btn ghost" onClick={() => act(() => api(`/api/courses/${id}/enroll`, { method: "DELETE", json: {} }))}>Leave course</button>
              )}
              {c.complete && (
                <a className="btn" href={`/certificate/${id}`}><Award size={15} /> Certificate</a>
              )}
              {c.author && (
                <>
                  <button className="btn" onClick={() => setEditing(true)}><Pencil size={15} /> Edit course</button>
                  <button className="btn" onClick={() => act(() => api(`/api/courses/${id}`, { method: "PATCH", json: { published: !c.published } }))}>
                    {c.published ? "Unpublish" : "Publish"}
                  </button>
                  <button className="btn ghost" onClick={() => setDel(true)}><Trash2 size={15} /> Delete</button>
                </>
              )}
            </div>
            {c.lessons.length === 0 && <p className="muted">{c.author ? "Add the first lesson from the list on the left." : "This course has no lessons yet."}</p>}
          </div>
        )}
      </div>
      {editing && (
        <CourseEditor
          course={c}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await load();
          }}
        />
      )}
      {lessonEdit && (
        <LessonEditor
          courseId={id}
          lesson={lessonEdit === "new" ? null : lessonEdit}
          onClose={() => setLessonEdit(null)}
          onSaved={async (lid) => {
            setLessonEdit(null);
            await load();
            if (lid) go({ course: id, lesson: lid });
          }}
          onDeleted={async () => {
            setLessonEdit(null);
            go({ course: id });
            await load();
          }}
        />
      )}
      {del && (
        <Confirm
          title="Delete course"
          message={`Delete "${c.title}", its lessons and everyone's progress? This can't be undone.`}
          action="Delete"
          danger
          onClose={() => setDel(false)}
          onConfirm={async () => {
            await api(`/api/courses/${id}`, { method: "DELETE" });
            go({ view: "manage" });
          }}
        />
      )}
    </div>
  );
}

function videoKind(url: string): "file" | "link" {
  try {
    return /\.(mp4|webm|ogg|m4v|mov)$/i.test(new URL(url).pathname) ? "file" : "link";
  } catch {
    return "link";
  }
}

function LessonView({ me, course, lesson, onDone, onNext, onEdit, onMove }: {
  me: MeInfo; course: Course; lesson: Lesson; onDone: () => Promise<unknown>; onNext: () => void; onEdit: () => void; onMove: (dir: "up" | "down") => void;
}) {
  const [answers, setAnswers] = useState<(number | null)[]>(() => lesson.quiz.map(() => null));
  const [result, setResult] = useState<{ passed: boolean; score: number | null; passMark: number; courseComplete: boolean } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const i = course.lessons.findIndex((l) => l.id === lesson.id);
  const last = i === course.lessons.length - 1;
  const complete = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await api<typeof result & object>(`/api/lessons/${lesson.id}/complete`, { method: "POST", json: { answers } });
      setResult(r);
      if (r.passed) await onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="lesson">
      <div className="toolbar">
        <div className="grow">
          <p className="muted small">Lesson {i + 1} of {course.lessons.length}{lesson.done ? " · done" : ""}{lesson.quiz_score !== null ? ` · quiz ${lesson.quiz_score}%` : ""}</p>
          <h1>{lesson.title}</h1>
        </div>
        {course.author && (
          <>
            <button className="iconbtn" aria-label="Move up" disabled={i === 0} onClick={() => onMove("up")}><ArrowUp size={16} /></button>
            <button className="iconbtn" aria-label="Move down" disabled={last} onClick={() => onMove("down")}><ArrowDown size={16} /></button>
            <button className="btn small" onClick={onEdit}><Pencil size={14} /> Edit</button>
          </>
        )}
      </div>
      {lesson.kind === "video" && lesson.video_url && (
        videoKind(lesson.video_url) === "file" ? (
          <video className="player" src={lesson.video_url} controls preload="metadata" />
        ) : (
          <p><a className="btn" href={lesson.video_url} target="_blank" rel="noreferrer noopener">Watch the video</a></p>
        )
      )}
      {lesson.content && <Prose text={lesson.content} />}
      {lesson.quiz.length > 0 && (
        <div className="quiz">
          <h3>Quiz · pass mark {me.passMark}%</h3>
          {lesson.quiz.map((x, qi) => (
            <fieldset key={qi}>
              <legend>{qi + 1}. {x.q}</legend>
              {x.options.map((o, oi) => (
                <label key={oi}>
                  <input
                    type="radio"
                    name={`q${qi}`}
                    checked={answers[qi] === oi}
                    onChange={() => setAnswers(answers.map((a, k) => (k === qi ? oi : a)))}
                  />
                  {o}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      )}
      <p className="error">{err}</p>
      {result && (
        <p className={result.passed ? "ok" : "error"}>
          {result.passed
            ? result.courseComplete
              ? `Course complete${result.score !== null ? ` (quiz ${result.score}%)` : ""}. Your certificate is ready.`
              : `Lesson done${result.score !== null ? `: you scored ${result.score}%` : ""}.`
            : `You scored ${result.score}%. You need ${result.passMark}% to pass; try again.`}
        </p>
      )}
      <div className="toolbar">
        {(!lesson.done || lesson.quiz.length > 0) && !(result?.passed) && (
          <button
            className="btn primary"
            disabled={busy || (lesson.quiz.length > 0 && answers.some((a) => a === null))}
            onClick={complete}
          >
            {lesson.quiz.length ? "Submit answers" : "Mark as done"}
          </button>
        )}
        {result?.courseComplete && <a className="btn" href={`/certificate/${course.id}`}><Award size={15} /> Certificate</a>}
        {!last && (lesson.done || result?.passed) && <button className="btn" onClick={onNext}>Next lesson</button>}
      </div>
    </div>
  );
}

function People({ course }: { course: Course }) {
  type Row = { email: string; assigned_by: string; due_day: string | null; done: number; pct: number; complete: boolean; overdue: boolean; last_activity: string | null };
  const [data, setData] = useState<{ lessonCount: number; roster: Row[] } | null>(null);
  const [err, setErr] = useState("");
  const [emails, setEmails] = useState("");
  const [due, setDue] = useState("");
  const load = useCallback(() => api<{ lessonCount: number; roster: Row[] }>(`/api/courses/${course.id}/roster`).then(setData).catch((e) => setErr(e.message)), [course.id]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="body">
      <h2>People</h2>
      <form
        className="toolbar"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr("");
          try {
            await api(`/api/courses/${course.id}/enroll`, { method: "POST", json: { emails, dueDay: due } });
            setEmails("");
            await load();
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        <input className="cellin grow" placeholder="Emails to assign, separated by commas" value={emails} onChange={(e) => setEmails(e.target.value)} aria-label="Emails to assign" />
        <label className="small muted">Due <input className="cellin" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <button className="btn primary" disabled={!emails.trim()}>Assign</button>
      </form>
      {!course.published && <p className="muted small">This course is a draft: people you assign see it once it is published.</p>}
      <p className="error">{err}</p>
      {!data ? (
        <p className="muted">Loading…</p>
      ) : data.roster.length === 0 ? (
        <div className="empty">Nobody is enrolled yet.</div>
      ) : (
        <div className="tablewrap">
          <table className="grid">
            <thead><tr><th>Person</th><th>Progress</th><th>Due</th><th>Last activity</th><th>Assigned by</th><th /></tr></thead>
            <tbody>
              {data.roster.map((r) => (
                <tr key={r.email}>
                  <td>{r.email}</td>
                  <td style={{ minWidth: 140 }}>{r.complete ? <span className="pill done">Completed</span> : <span className="small">{r.done} of {data.lessonCount}</span>}<Meter pct={r.pct} /></td>
                  <td>{r.due_day ? <>{dayText(r.due_day)} {r.overdue && <span className="pill overdue">Overdue</span>}</> : ""}</td>
                  <td>{r.last_activity ? when(r.last_activity) : <span className="muted">Not started</span>}</td>
                  <td>{r.assigned_by === r.email ? "Themselves" : person(r.assigned_by)}</td>
                  <td>
                    <button
                      className="iconbtn small"
                      aria-label={`Remove ${r.email}`}
                      onClick={async () => {
                        await api(`/api/courses/${course.id}/enroll`, { method: "DELETE", json: { email: r.email } }).catch((e) => setErr(e.message));
                        await load();
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CourseEditor({ course, onClose, onSaved }: { course: Course | null; onClose: () => void; onSaved: (c: { id: string }) => void }) {
  const [f, setF] = useState({
    title: course?.title ?? "", description: course?.description ?? "", category: course?.category ?? "General",
    minutes: course?.minutes ? String(course.minutes) : "", published: course?.published ?? false,
  });
  const [err, setErr] = useState("");
  return (
    <Modal title={course ? "Edit course" : "New course"} onClose={onClose} wide>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr("");
          try {
            onSaved(await api<{ id: string }>(course ? `/api/courses/${course.id}` : "/api/courses", { method: course ? "PATCH" : "POST", json: f }));
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        <label><span>Title</span><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required autoFocus /></label>
        <div className="row2">
          <label><span>Category</span><input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></label>
          <label><span>Length in minutes (optional)</span><input inputMode="numeric" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} /></label>
        </div>
        <label><span>Description</span><textarea rows={5} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={f.published} onChange={(e) => setF({ ...f, published: e.target.checked })} /> Published (in the catalog for everyone)</label>
        <p className="error">{err}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}

function LessonEditor({ courseId, lesson, onClose, onSaved, onDeleted }: {
  courseId: string; lesson: Lesson | null; onClose: () => void; onSaved: (id: string | null) => void; onDeleted: () => void;
}) {
  const [f, setF] = useState({ title: lesson?.title ?? "", kind: lesson?.kind ?? "text", videoUrl: lesson?.video_url ?? "", content: lesson?.content ?? "" });
  const [quiz, setQuiz] = useState<Question[]>(() => (lesson?.quiz ?? []).map((x) => ({ q: x.q, options: [...x.options], answer: x.answer ?? 0 })));
  const [err, setErr] = useState("");
  const [del, setDel] = useState(false);
  const setQ = (i: number, next: Partial<Question>) => setQuiz(quiz.map((x, k) => (k === i ? { ...x, ...next } : x)));
  return (
    <Modal title={lesson ? "Edit lesson" : "New lesson"} onClose={onClose} wide>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr("");
          try {
            const json = { ...f, quiz };
            if (lesson) {
              await api(`/api/lessons/${lesson.id}`, { method: "PATCH", json });
              onSaved(lesson.id);
            } else {
              const r = await api<{ id: string }>(`/api/courses/${courseId}/lessons`, { method: "POST", json });
              onSaved(r.id);
            }
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        <div className="row2">
          <label><span>Title</span><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required autoFocus /></label>
          <label>
            <span>Kind</span>
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="text">Reading</option>
              <option value="video">Video</option>
            </select>
          </label>
        </div>
        {f.kind === "video" && (
          <label><span>Video link (Stream, Drive or any https address)</span><input type="url" value={f.videoUrl} onChange={(e) => setF({ ...f, videoUrl: e.target.value })} placeholder="https://" /></label>
        )}
        <label>
          <span>{f.kind === "video" ? "Notes under the video" : "Text"}</span>
          <textarea rows={10} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} placeholder={"Paragraphs, with - for lists and ## for headings"} />
        </label>
        <h3>Quiz {quiz.length ? `(${quiz.length})` : "(none)"}</h3>
        {quiz.map((x, i) => (
          <div key={i} className="qedit">
            <div className="opt">
              <input className="cellin" type="text" value={x.q} onChange={(e) => setQ(i, { q: e.target.value })} placeholder={`Question ${i + 1}`} />
              <button type="button" className="iconbtn small" aria-label="Remove question" onClick={() => setQuiz(quiz.filter((_, k) => k !== i))}><Trash2 size={14} /></button>
            </div>
            {x.options.map((o, oi) => (
              <div key={oi} className="opt">
                <input type="radio" name={`ans${i}`} checked={x.answer === oi} onChange={() => setQ(i, { answer: oi })} aria-label="Right answer" title="Right answer" />
                <input
                  className="cellin"
                  type="text"
                  value={o}
                  onChange={(e) => setQ(i, { options: x.options.map((v, k) => (k === oi ? e.target.value : v)) })}
                  placeholder={`Answer ${oi + 1}`}
                />
                <button
                  type="button"
                  className="iconbtn small"
                  aria-label="Remove answer"
                  disabled={x.options.length <= 2}
                  onClick={() => setQ(i, { options: x.options.filter((_, k) => k !== oi), answer: Math.max(0, Math.min((x.answer ?? 0) > oi ? (x.answer ?? 0) - 1 : x.answer ?? 0, x.options.length - 2)) })}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <div><button type="button" className="btn small ghost" onClick={() => setQ(i, { options: [...x.options, ""] })}><Plus size={14} /> Answer</button></div>
          </div>
        ))}
        <div><button type="button" className="btn small" onClick={() => setQuiz([...quiz, { q: "", options: ["", ""], answer: 0 }])}><Plus size={14} /> Add question</button></div>
        <p className="muted small">Pick the right answer with the circle next to it. Learners never see which one it is.</p>
        <p className="error">{err}</p>
        <div className="actions">
          {lesson && <button type="button" className="btn ghost" style={{ marginRight: "auto" }} onClick={() => setDel(true)}><Trash2 size={14} /> Delete</button>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Save</button>
        </div>
      </form>
      {del && lesson && (
        <Confirm
          title="Delete lesson"
          message={`Delete "${lesson.title}" and everyone's progress on it?`}
          action="Delete"
          danger
          onClose={() => setDel(false)}
          onConfirm={async () => {
            await api(`/api/lessons/${lesson.id}`, { method: "DELETE" });
            onDeleted();
          }}
        />
      )}
    </Modal>
  );
}
