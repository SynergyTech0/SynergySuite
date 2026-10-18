"use client";
import { Briefcase, ExternalLink, Globe, Plus, Settings, Sparkles, Star, Trash2, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Confirm, Modal } from "./Modal";
import { Prose } from "./Prose";
import { api, person, shortDate, since, when } from "./client";
import { SOURCE_LABELS, STAGE_LABELS, STATUS_LABELS, TYPE_LABELS } from "./labels";

type MeInfo = { email: string; name: string; recruiter: boolean; ai: boolean; stages: string[]; employmentTypes: string[]; careersUrl: string };
type Job = {
  id: string; slug: string; title: string; department: string; location: string; employment_type: string; remote: boolean;
  salary: string; description: string; status: string; hiring_manager: string; modified_at: string; opened_at: string | null;
  counts?: Record<string, number>; total?: number;
};
type Candidate = {
  id: string; job_id: string; name: string; email: string; phone: string; profile_url: string; resume_url: string; cover_note: string;
  source: string; stage: string; rating: number; stage_changed_at: string; hr_person_id: string | null; created_at: string;
};
type Detail = Candidate & {
  job: { id: string; title: string; department: string; location: string; hiring_manager: string };
  events: { id: string; kind: string; body: string; author: string; created_at: string }[];
  hr_url: string | null;
};

function useUrlParam(name: string): [string | null, (v: string | null) => void] {
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setValue(new URLSearchParams(location.search).get(name));
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [name]);
  const set = useCallback(
    (v: string | null) => {
      const u = new URL(location.href);
      if (v) u.searchParams.set(name, v);
      else u.searchParams.delete(name);
      if (name === "job") u.searchParams.delete("candidate");
      history.pushState(null, "", u);
      setValue(v);
    },
    [name],
  );
  return [value, set];
}

export function HireApp(_: { me: { email: string; name: string } }) {
  const [me, setMe] = useState<MeInfo | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [jobId, setJobId] = useUrlParam("job");
  const [candId, setCandId] = useUrlParam("candidate");
  const [editing, setEditing] = useState<Job | "new" | null>(null);
  const [settings, setSettings] = useState(false);
  const [err, setErr] = useState("");

  const loadJobs = useCallback(() => api<Job[]>("/api/jobs").then(setJobs).catch((e) => setErr(e.message)), []);
  useEffect(() => {
    api<MeInfo>("/api/me").then(setMe).catch((e) => setErr(e.message));
    void loadJobs();
  }, [loadJobs]);

  const job = jobs?.find((j) => j.id === jobId) ?? null;
  if (err) return <div className="pad error">{err}</div>;
  if (!me || !jobs) return <div className="pad muted">Loading…</div>;
  if (!me.recruiter && jobs.length === 0) {
    return (
      <div className="pad">
        <h1>Hire</h1>
        <p className="muted">You aren&apos;t a recruiter or the hiring manager for any job. A recruiter can make you a job&apos;s hiring manager.</p>
      </div>
    );
  }

  const groups = (["open", "draft", "closed"] as const).map((s) => [s, jobs.filter((j) => j.status === s)] as const);
  return (
    <div className="app">
      <nav className="nav">
        {me.recruiter && (
          <button className="btn primary newbtn" onClick={() => setEditing("new")}>
            <Plus size={16} /> New job
          </button>
        )}
        <button className={`navitem${!jobId ? " active" : ""}`} onClick={() => setJobId(null)}>
          <Briefcase size={16} /> All jobs
        </button>
        {groups.map(([s, list]) =>
          list.length ? (
            <div key={s}>
              <div className="navsection">{STATUS_LABELS[s]}</div>
              {list.map((j) => (
                <button key={j.id} className={`navitem${j.id === jobId ? " active" : ""}`} onClick={() => setJobId(j.id)}>
                  <span className="fname">{j.title}</span>
                  {!!j.total && <span className="code">{j.total}</span>}
                </button>
              ))}
            </div>
          ) : null,
        )}
        <div className="navsection">Careers page</div>
        <a className="navitem" href={me.careersUrl} target="_blank" rel="noreferrer">
          <Globe size={16} /> Open careers page
        </a>
        {me.recruiter && (
          <button className="navitem" onClick={() => setSettings(true)}>
            <Settings size={16} /> Careers page settings
          </button>
        )}
      </nav>
      <main className="main">
        {job ? (
          <JobView
            key={job.id}
            me={me}
            job={job}
            careersUrl={me.careersUrl}
            candId={candId}
            setCandId={setCandId}
            onEdit={() => setEditing(job)}
            onChanged={loadJobs}
          />
        ) : (
          <Overview jobs={jobs} recruiter={me.recruiter} onOpen={setJobId} onNew={() => setEditing("new")} />
        )}
      </main>
      {editing && (
        <JobEditor
          me={me}
          job={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (j) => {
            setEditing(null);
            await loadJobs();
            setJobId(j.id);
          }}
          onDeleted={async () => {
            setEditing(null);
            setJobId(null);
            await loadJobs();
          }}
        />
      )}
      {settings && <CareersSettings onClose={() => setSettings(false)} />}
    </div>
  );
}

function Overview({ jobs, recruiter, onOpen, onNew }: { jobs: Job[]; recruiter: boolean; onOpen: (id: string) => void; onNew: () => void }) {
  const open = jobs.filter((j) => j.status === "open");
  const sum = (stage: string) => jobs.reduce((a, j) => a + (j.status === "open" ? j.counts?.[stage] ?? 0 : 0), 0);
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Jobs</h1>
          <p className="sub muted">{recruiter ? "Every job and where its candidates are." : "The jobs you are hiring for."}</p>
        </div>
      </div>
      <div className="body">
        <div className="kpis">
          <div className="kpi"><span className="muted">Open jobs</span><b>{open.length}</b></div>
          <div className="kpi"><span className="muted">New applications</span><b>{sum("applied")}</b></div>
          <div className="kpi"><span className="muted">Interviewing</span><b>{sum("interview")}</b></div>
          <div className="kpi"><span className="muted">Offers out</span><b>{sum("offer")}</b></div>
        </div>
        {jobs.length === 0 ? (
          <div className="empty">
            <p>No jobs yet.</p>
            {recruiter && <button className="btn primary" onClick={onNew}><Plus size={16} /> New job</button>}
          </div>
        ) : (
          <div className="tablewrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Job</th><th>Status</th><th>Hiring manager</th>
                  {["applied", "screening", "interview", "offer", "hired"].map((s) => <th key={s} className="num">{STAGE_LABELS[s]}</th>)}
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="click" onClick={() => onOpen(j.id)}>
                    <td><b>{j.title}</b><div className="muted small">{[j.department, j.location].filter(Boolean).join(" · ")}</div></td>
                    <td><span className={`pill ${j.status}`}>{STATUS_LABELS[j.status]}</span></td>
                    <td>{j.hiring_manager ? person(j.hiring_manager) : <span className="muted">None</span>}</td>
                    {["applied", "screening", "interview", "offer", "hired"].map((s) => <td key={s} className="num">{j.counts?.[s] || ""}</td>)}
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

function Stars({ value, onChange }: { value: number; onChange?: (n: number) => void }) {
  return (
    <span className={`stars${onChange ? "" : " ro"}`} aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={n <= value ? "on" : ""}
          disabled={!onChange}
          onClick={(e) => {
            e.stopPropagation();
            onChange?.(n === value ? 0 : n);
          }}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
        >
          <Star size={14} fill={n <= value ? "currentColor" : "none"} />
        </button>
      ))}
    </span>
  );
}

function JobView({ me, job, careersUrl, candId, setCandId, onEdit, onChanged }: {
  me: MeInfo; job: Job; careersUrl: string; candId: string | null; setCandId: (v: string | null) => void; onEdit: () => void; onChanged: () => void;
}) {
  const [list, setList] = useState<Candidate[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<"pipeline" | "details">("pipeline");
  const [over, setOver] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => api<Candidate[]>(`/api/jobs/${job.id}/candidates`).then(setList).catch((e) => setErr(e.message)), [job.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const move = async (id: string, stage: string) => {
    setErr("");
    try {
      await api(`/api/candidates/${id}`, { method: "PATCH", json: { stage } });
      await load();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>{job.title} <span className={`pill ${job.status}`}>{STATUS_LABELS[job.status]}</span></h1>
          <p className="sub muted">
            {[job.department, job.location, job.remote ? "Remote possible" : "", TYPE_LABELS[job.employment_type],
              job.hiring_manager ? `Hiring manager: ${person(job.hiring_manager, me.email)}` : ""].filter(Boolean).join(" · ")}
          </p>
        </div>
        {job.status === "open" && (
          <a className="btn" href={`${careersUrl}/${job.slug}`} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Job page</a>
        )}
        <button className="btn" onClick={() => setAdding(true)}><UserPlus size={15} /> Add candidate</button>
        {me.recruiter && <button className="btn" onClick={onEdit}>Edit job</button>}
      </div>
      <div className="tabs">
        <button className={`tab${tab === "pipeline" ? " on" : ""}`} onClick={() => setTab("pipeline")}>Pipeline</button>
        <button className={`tab${tab === "details" ? " on" : ""}`} onClick={() => setTab("details")}>Description</button>
      </div>
      <div className="body">
        <p className="error">{err}</p>
        {tab === "details" ? (
          job.description ? <div style={{ maxWidth: 760 }}><Prose text={job.description} /></div> : <p className="muted">No description yet.</p>
        ) : !list ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="board">
            {me.stages.map((s) => {
              const cards = list.filter((c) => c.stage === s);
              return (
                <div
                  key={s}
                  className={`col${over === s ? " over" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(s);
                  }}
                  onDragLeave={() => setOver(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOver(null);
                    const id = e.dataTransfer.getData("text/plain");
                    const c = list.find((x) => x.id === id);
                    if (c && c.stage !== s) void move(id, s);
                  }}
                >
                  <div className="colhead"><span>{STAGE_LABELS[s]}</span><span className="muted">{cards.length}</span></div>
                  <div className="colbody">
                    {cards.map((c) => (
                      <button
                        key={c.id}
                        className={`card${c.id === candId ? " sel" : ""}`}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)}
                        onClick={() => setCandId(c.id)}
                      >
                        <b>{c.name}</b>
                        <span className="muted small">{SOURCE_LABELS[c.source]} · {since(c.stage_changed_at)}</span>
                        {c.rating > 0 && <Stars value={c.rating} />}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {candId && (
        <CandidatePanel
          key={candId}
          me={me}
          id={candId}
          onClose={() => setCandId(null)}
          onChanged={() => {
            void load();
            onChanged();
          }}
        />
      )}
      {adding && (
        <AddCandidate
          jobId={job.id}
          onClose={() => setAdding(false)}
          onAdded={async (c) => {
            setAdding(false);
            await load();
            onChanged();
            setCandId(c.id);
          }}
        />
      )}
    </>
  );
}

function CandidatePanel({ me, id, onClose, onChanged }: { me: MeInfo; id: string; onClose: () => void; onChanged: () => void }) {
  const [c, setC] = useState<Detail | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [hr, setHr] = useState(false);
  const [del, setDel] = useState(false);
  const load = useCallback(() => api<Detail>(`/api/candidates/${id}`).then(setC).catch((e) => setErr(e.message)), [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (json: Record<string, unknown>) => {
    setErr("");
    try {
      await api(`/api/candidates/${id}`, { method: "PATCH", json });
      await load();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <aside className="panel" aria-label="Candidate">
      <div className="modalhead">
        <h2>{c?.name ?? "Candidate"}</h2>
        <button className="iconbtn" aria-label="Close" onClick={onClose}><X size={18} /></button>
      </div>
      {!c ? (
        <div className="panelbody">{err ? <p className="error">{err}</p> : <p className="muted">Loading…</p>}</div>
      ) : (
        <div className="panelbody">
          <div className="toolbar">
            <select className="cellin" value={c.stage} onChange={(e) => void patch({ stage: e.target.value })} aria-label="Stage">
              {me.stages.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
            </select>
            <Stars value={c.rating} onChange={(n) => void patch({ rating: n })} />
          </div>
          <p className="error">{err}</p>
          <dl className="facts">
            <dt>Email</dt><dd><a href={`mailto:${c.email}`}>{c.email}</a></dd>
            {c.phone && <><dt>Phone</dt><dd><a href={`tel:${c.phone}`}>{c.phone}</a></dd></>}
            {c.profile_url && <><dt>Profile</dt><dd><a href={c.profile_url} target="_blank" rel="noreferrer noopener">{c.profile_url}</a></dd></>}
            {c.resume_url && <><dt>Résumé</dt><dd><a href={c.resume_url} target="_blank" rel="noreferrer noopener">Open résumé</a></dd></>}
            <dt>Source</dt><dd>{SOURCE_LABELS[c.source]}</dd>
            <dt>Applied</dt><dd>{shortDate(c.created_at)}</dd>
          </dl>
          {c.cover_note && (
            <div>
              <h3>Why this job</h3>
              <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{c.cover_note}</p>
            </div>
          )}
          {c.stage === "hired" && (
            <div className="box" style={{ padding: "10px 12px" }}>
              {c.hr_url ? (
                <a href={c.hr_url} target="_blank" rel="noreferrer">Open their HR record</a>
              ) : (
                <div className="toolbar">
                  <span className="grow small">Hired. Add them to HR to set up their employee record.</span>
                  <button className="btn small primary" onClick={() => setHr(true)}>Add to HR</button>
                </div>
              )}
            </div>
          )}
          <form
            className="note"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!note.trim()) return;
              setErr("");
              try {
                await api(`/api/candidates/${id}/notes`, { method: "POST", json: { body: note } });
                setNote("");
                await load();
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            <h3>Notes</h3>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Interview feedback, next steps…" rows={3} />
            <div className="actions"><button className="btn small" disabled={!note.trim()}>Add note</button></div>
          </form>
          <div className="timeline">
            {c.events.map((ev) => (
              <div key={ev.id} className={`event ${ev.kind}`}>
                <span className="muted small">{person(ev.author, me.email)} · {when(ev.created_at)}</span>
                <p>{ev.body}</p>
              </div>
            ))}
          </div>
          {me.recruiter && (
            <div>
              <button className="btn small ghost" onClick={() => setDel(true)}><Trash2 size={14} /> Delete candidate</button>
            </div>
          )}
        </div>
      )}
      {hr && c && (
        <AddToHr
          c={c}
          onClose={() => setHr(false)}
          onDone={async () => {
            setHr(false);
            await load();
            onChanged();
          }}
        />
      )}
      {del && c && (
        <Confirm
          title="Delete candidate"
          message={`Delete ${c.name} and their notes? This can't be undone.`}
          action="Delete"
          danger
          onClose={() => setDel(false)}
          onConfirm={async () => {
            await api(`/api/candidates/${id}`, { method: "DELETE" });
            onChanged();
            onClose();
          }}
        />
      )}
    </aside>
  );
}

function AddCandidate({ jobId, onClose, onAdded }: { jobId: string; onClose: () => void; onAdded: (c: Candidate) => void }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Add candidate" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr("");
          try {
            onAdded(await api<Candidate>(`/api/jobs/${jobId}/candidates`, { method: "POST", json: Object.fromEntries(new FormData(e.currentTarget)) }));
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="row2">
          <label><span>Name</span><input name="name" required autoFocus /></label>
          <label><span>Email</span><input name="email" type="email" required /></label>
        </div>
        <div className="row2">
          <label><span>Phone</span><input name="phone" /></label>
          <label><span>Source</span><select name="source" defaultValue="manual"><option value="manual">Sourced</option><option value="referral">Referral</option></select></label>
        </div>
        <label><span>Profile link</span><input name="profileUrl" type="url" placeholder="https://" /></label>
        <label><span>Résumé link</span><input name="resumeUrl" type="url" placeholder="https://" /></label>
        <label><span>Notes</span><textarea name="coverNote" rows={3} /></label>
        <p className="error">{err}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Add</button>
        </div>
      </form>
    </Modal>
  );
}

function AddToHr({ c, onClose, onDone }: { c: Detail; onClose: () => void; onDone: () => void }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Add to HR" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr("");
          try {
            await api(`/api/candidates/${c.id}/hr`, { method: "POST", json: Object.fromEntries(new FormData(e.currentTarget)) });
            onDone();
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="muted small">HR keeps the employee record. Only HR admins can add people there.</p>
        <div className="row2">
          <label><span>Name</span><input name="name" defaultValue={c.name} required /></label>
          <label><span>Work email</span><input name="email" type="email" defaultValue={c.email} required /></label>
        </div>
        <div className="row2">
          <label><span>Title</span><input name="title" defaultValue={c.job.title} /></label>
          <label><span>Department</span><input name="department" defaultValue={c.job.department} /></label>
        </div>
        <div className="row2">
          <label><span>Location</span><input name="location" defaultValue={c.job.location} /></label>
          <label><span>Start date</span><input name="startDate" type="date" /></label>
        </div>
        <label><span>Manager&apos;s email</span><input name="managerEmail" type="email" defaultValue={c.job.hiring_manager} /></label>
        <p className="error">{err}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? "Adding…" : "Add to HR"}</button>
        </div>
      </form>
    </Modal>
  );
}

function JobEditor({ me, job, onClose, onSaved, onDeleted }: {
  me: MeInfo; job: Job | null; onClose: () => void; onSaved: (j: Job) => void; onDeleted: () => void;
}) {
  const [f, setF] = useState({
    title: job?.title ?? "", department: job?.department ?? "", location: job?.location ?? "", employmentType: job?.employment_type ?? "full_time",
    remote: job?.remote ?? false, salary: job?.salary ?? "", description: job?.description ?? "", status: job?.status ?? "draft",
    hiringManager: job?.hiring_manager ?? "",
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [del, setDel] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target instanceof HTMLInputElement && e.target.type === "checkbox" ? e.target.checked : e.target.value });
  return (
    <Modal title={job ? "Edit job" : "New job"} onClose={onClose} wide>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr("");
          try {
            onSaved(await api<Job>(job ? `/api/jobs/${job.id}` : "/api/jobs", { method: job ? "PATCH" : "POST", json: f }));
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label><span>Title</span><input value={f.title} onChange={set("title")} required autoFocus /></label>
        <div className="row3">
          <label><span>Department</span><input value={f.department} onChange={set("department")} /></label>
          <label><span>Location</span><input value={f.location} onChange={set("location")} /></label>
          <label>
            <span>Type</span>
            <select value={f.employmentType} onChange={set("employmentType")}>
              {me.employmentTypes.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </label>
        </div>
        <div className="row3">
          <label><span>Pay (shown on the job page)</span><input value={f.salary} onChange={set("salary")} placeholder="Optional" /></label>
          <label><span>Hiring manager&apos;s email</span><input type="email" value={f.hiringManager} onChange={set("hiringManager")} /></label>
          <label>
            <span>Status</span>
            <select value={f.status} onChange={set("status")}>
              <option value="draft">Draft (not public)</option>
              <option value="open">Open (on the careers page)</option>
              <option value="closed">Closed</option>
            </select>
          </label>
        </div>
        <label className="check"><input type="checkbox" checked={f.remote} onChange={set("remote")} /> Remote work possible</label>
        <label>
          <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            Description
            {me.ai && (
              <button
                type="button"
                className="btn small ghost"
                disabled={drafting || !f.title.trim()}
                onClick={async () => {
                  setDrafting(true);
                  setErr("");
                  try {
                    const r = await api<{ description: string }>("/api/ai/describe", { method: "POST", json: f });
                    setF((cur) => ({ ...cur, description: r.description }));
                  } catch (e) {
                    setErr((e as Error).message);
                  } finally {
                    setDrafting(false);
                  }
                }}
              >
                <Sparkles size={14} /> {drafting ? "Drafting…" : f.description ? "Improve with AI" : "Draft with AI"}
              </button>
            )}
          </span>
          <textarea value={f.description} onChange={set("description")} rows={12} placeholder={"About the role\n\n- What you'll do\n- What you'll bring"} />
        </label>
        <p className="error">{err}</p>
        <div className="actions">
          {job && <button type="button" className="btn ghost" style={{ marginRight: "auto" }} onClick={() => setDel(true)}><Trash2 size={14} /> Delete</button>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Save</button>
        </div>
      </form>
      {del && job && (
        <Confirm
          title="Delete job"
          message={`Delete "${job.title}" and all ${job.total ?? 0} of its candidates? Closing it keeps them instead.`}
          action="Delete"
          danger
          onClose={() => setDel(false)}
          onConfirm={async () => {
            await api(`/api/jobs/${job.id}`, { method: "DELETE" });
            onDeleted();
          }}
        />
      )}
    </Modal>
  );
}

function CareersSettings({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState<{ company: string; intro: string; contact: string } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api<{ company: string; intro: string; contact: string }>("/api/settings").then(setF).catch((e) => setErr(e.message));
  }, []);
  return (
    <Modal title="Careers page" onClose={onClose} wide>
      {!f ? (
        <div className="form">{err ? <p className="error">{err}</p> : <p className="muted">Loading…</p>}</div>
      ) : (
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr("");
            try {
              await api("/api/settings", { method: "PUT", json: f });
              onClose();
            } catch (e) {
              setErr((e as Error).message);
            }
          }}
        >
          <label><span>Organization name</span><input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></label>
          <label><span>Introduction</span><textarea rows={5} value={f.intro} onChange={(e) => setF({ ...f, intro: e.target.value })} /></label>
          <label><span>Contact email for questions (optional)</span><input type="email" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></label>
          <p className="error">{err}</p>
          <div className="actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary">Save</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
