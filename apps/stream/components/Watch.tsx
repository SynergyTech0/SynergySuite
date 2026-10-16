"use client";
import { Captions, Clapperboard, Download, Lock, MessageSquare, Pencil, Share2, Sparkles, Trash2, Building2, ListOrdered, ScrollText } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Chapter, type Cue, clock, parseClock, parseCues } from "@/lib/captions";
import type { Comment, VideoDetail } from "@/lib/videos";
import { api, bytes, dayLabel, person, viewsLabel } from "./client";
import { Modal } from "./Modal";
import { ShareDialog } from "./ShareDialog";

type Ai = { speech: boolean; text: boolean };
type Tab = "chapters" | "transcript" | "comments";

/** The watch page: player, details, chapters, transcript and comments, plus the owner's tools. */
export function Watch({ id, me }: { id: string; me: string }) {
  const [video, setVideo] = useState<VideoDetail | null>(null);
  const [error, setError] = useState("");
  const [ai, setAi] = useState<Ai>({ speech: false, text: false });
  const [cues, setCues] = useState<Cue[]>([]);
  const [tab, setTab] = useState<Tab>("comments");
  const [time, setTime] = useState(0);
  const [dialog, setDialog] = useState<"share" | "details" | "captions" | null>(null);
  const player = useRef<HTMLVideoElement>(null);
  const counted = useRef(false);

  const load = useCallback(async () => {
    try {
      const { video } = await api<{ video: VideoDetail }>(`/api/videos/${id}`);
      setVideo(video);
      document.title = `${video.title} · Synergy Stream`;
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
    api<{ ai: Ai }>("/api/me").then((r) => setAi(r.ai)).catch(() => {});
  }, [load]);

  // Poll while processing or captioning.
  const waiting = video?.status === "processing" || video?.captions_status === "working";
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [waiting, load]);

  // The transcript panel reads the same captions the player shows.
  const captionsKey = video?.has_captions ? video.modified_at : "";
  useEffect(() => {
    if (!captionsKey) return setCues([]);
    fetch(`/api/videos/${id}/captions`).then((r) => (r.ok ? r.text() : "")).then((t) => setCues(parseCues(t))).catch(() => setCues([]));
  }, [id, captionsKey]);

  useEffect(() => {
    if (video && video.chapters.length && tab === "comments" && !video.allow_comments) setTab("chapters");
  }, [video, tab]);

  const seek = (t: number) => {
    const p = player.current;
    if (!p) return;
    p.currentTime = t;
    void p.play().catch(() => {});
  };

  if (error) return <div className="pad"><h1>{error === "Not found" ? "This video isn't available" : "Something went wrong"}</h1><p className="muted">{error === "Not found" ? "It may have been deleted, or it hasn't been shared with you." : error}</p><a href="/">Back to Stream</a></div>;
  if (!video) return <p className="pad muted">Loading…</p>;

  const chapterNow = [...video.chapters].reverse().find((c) => c.t <= time);

  return (
    <div className="watch">
      <section className="stage">
        <div className="playerbox">
          {video.status === "ready" ? (
            <video
              ref={player}
              controls
              playsInline
              preload="metadata"
              poster={`/api/videos/${id}/poster`}
              src={`/api/videos/${id}/media`}
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onPlay={() => {
                if (counted.current) return;
                counted.current = true;
                void api(`/api/videos/${id}/view`, { method: "POST" }).catch(() => {});
              }}
            >
              {video.has_captions && <track kind="captions" src={`/api/videos/${id}/captions?v=${encodeURIComponent(video.modified_at)}`} srcLang="en" label="Captions" default />}
            </video>
          ) : video.status === "processing" ? (
            <div className="placeholder">
              <p>Getting this video ready to watch… {video.progress ? `${video.progress}%` : ""}</p>
              <progress max={100} value={video.progress || undefined} />
            </div>
          ) : (
            <div className="placeholder bad">
              <p>Stream couldn&apos;t process this video.</p>
              <p className="small">{video.error}</p>
            </div>
          )}
        </div>

        <div className="meta">
          <h1>{video.title}</h1>
          <div className="metarow">
            <span className="muted">
              {person(video.owner, me)} · {viewsLabel(video.views)} · {dayLabel(video.created_at)}
              {chapterNow ? ` · ${chapterNow.title}` : ""}
            </span>
            <span className="grow" />
            {video.can_edit && (
              <button className="btn small" onClick={() => setDialog("share")}>
                {video.visibility === "org" ? <Building2 size={15} /> : video.shared ? <Share2 size={15} /> : <Lock size={15} />} Share
              </button>
            )}
            {video.can_edit && (
              <button className="btn small" onClick={() => setDialog("details")}>
                <Pencil size={15} /> Edit details
              </button>
            )}
            {video.can_edit && (
              <button className="btn small" onClick={() => setDialog("captions")}>
                <Captions size={15} /> Captions
              </button>
            )}
            {video.status === "ready" && (
              <a className="btn small" href={`/edit?video=${id}`}>
                <Clapperboard size={15} /> Open in editor
              </a>
            )}
            <a className="btn small" href={`/api/videos/${id}/media?download`} title={`${video.source_name} · ${bytes(video.size)}`}>
              <Download size={15} /> Download
            </a>
            {video.can_edit && (
              <button
                className="btn small ghost"
                aria-label="Delete video"
                onClick={async () => {
                  if (!confirm(`Delete "${video.title}"? People it's shared with won't be able to watch it any more.`)) return;
                  try {
                    await api(`/api/videos/${id}`, { method: "DELETE" });
                    location.href = "/";
                  } catch (e) {
                    alert((e as Error).message);
                  }
                }}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
          {video.summary && (
            <div className="summary">
              <Sparkles size={14} /> <span>{video.summary}</span>
            </div>
          )}
          {video.description && <p className="description">{video.description}</p>}
        </div>
      </section>

      <aside className="side">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "chapters"} className={tab === "chapters" ? "on" : ""} onClick={() => setTab("chapters")}>
            <ListOrdered size={15} /> Chapters
          </button>
          <button role="tab" aria-selected={tab === "transcript"} className={tab === "transcript" ? "on" : ""} onClick={() => setTab("transcript")}>
            <ScrollText size={15} /> Transcript
          </button>
          <button role="tab" aria-selected={tab === "comments"} className={tab === "comments" ? "on" : ""} onClick={() => setTab("comments")}>
            <MessageSquare size={15} /> Comments
          </button>
        </div>
        {tab === "chapters" && <Chapters chapters={video.chapters} time={time} onSeek={seek} canEdit={video.can_edit} onEdit={() => setDialog("details")} />}
        {tab === "transcript" && <Transcript cues={cues} time={time} onSeek={seek} canEdit={video.can_edit} onAdd={() => setDialog("captions")} />}
        {tab === "comments" && <Comments id={id} me={me} allowed={video.allow_comments} time={time} onSeek={seek} />}
      </aside>

      {dialog === "share" && <ShareDialog video={video} onChange={setVideo} onClose={() => setDialog(null)} />}
      {dialog === "details" && <DetailsDialog video={video} ai={ai} onChange={setVideo} onClose={() => setDialog(null)} />}
      {dialog === "captions" && <CaptionsDialog video={video} ai={ai} onChange={setVideo} onClose={() => setDialog(null)} />}
    </div>
  );
}

function Chapters({ chapters, time, onSeek, canEdit, onEdit }: { chapters: Chapter[]; time: number; onSeek: (t: number) => void; canEdit: boolean; onEdit: () => void }) {
  if (!chapters.length) {
    return (
      <div className="panel muted">
        No chapters. {canEdit && <button className="linkbtn" onClick={onEdit}>Add chapters</button>}
      </div>
    );
  }
  const current = [...chapters].reverse().find((c) => c.t <= time);
  return (
    <ol className="panel chapters">
      {chapters.map((c) => (
        <li key={c.t}>
          <button className={current === c ? "on" : ""} onClick={() => onSeek(c.t)}>
            <span className="stamp">{clock(c.t)}</span> {c.title}
          </button>
        </li>
      ))}
    </ol>
  );
}

function Transcript({ cues, time, onSeek, canEdit, onAdd }: { cues: Cue[]; time: number; onSeek: (t: number) => void; canEdit: boolean; onAdd: () => void }) {
  const [find, setFind] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => (find ? cues.filter((c) => c.text.toLowerCase().includes(find.toLowerCase())) : cues), [cues, find]);
  const current = cues.findLastIndex((c) => c.start <= time);
  useEffect(() => {
    if (find) return;
    box.current?.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  }, [current, find]);
  if (!cues.length) {
    return (
      <div className="panel muted">
        No transcript yet. {canEdit && <button className="linkbtn" onClick={onAdd}>Add captions</button>}
      </div>
    );
  }
  return (
    <div className="panel transcript">
      <input className="find" placeholder="Find in transcript" value={find} onChange={(e) => setFind(e.target.value)} />
      <div ref={box} className="cues">
        {shown.map((c, i) => (
          <button key={`${c.start}-${i}`} className={!find && cues[current] === c ? "on" : ""} onClick={() => onSeek(c.start)}>
            <span className="stamp">{clock(c.start)}</span> <span>{c.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Comments({ id, me, allowed, time, onSeek }: { id: string; me: string; allowed: boolean; time: number; onSeek: (t: number) => void }) {
  const [list, setList] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [pin, setPin] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(() => api<{ comments: Comment[] }>(`/api/videos/${id}/comments`).then((r) => setList(r.comments)).catch((e: Error) => setError(e.message)), [id]);
  useEffect(() => void load(), [load]);
  return (
    <div className="panel comments">
      {list === null ? (
        <p className="muted">Loading…</p>
      ) : list.length === 0 ? (
        <p className="muted">{allowed ? "No comments yet." : "Comments are turned off."}</p>
      ) : (
        <ul>
          {list.map((c) => (
            <li key={c.id}>
              <div className="who">
                <strong>{person(c.author, me)}</strong>
                <span className="muted small">{dayLabel(c.created_at)}</span>
                {c.mine && (
                  <button
                    className="linkbtn small"
                    onClick={async () => {
                      await api(`/api/videos/${id}/comments/${c.id}`, { method: "DELETE" }).catch((e: Error) => setError(e.message));
                      void load();
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
              <p>
                {c.at_seconds !== null && (
                  <button className="stamp linkish" onClick={() => onSeek(c.at_seconds!)}>{clock(c.at_seconds)}</button>
                )}{" "}
                {c.body}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="error" role="alert">{error}</p>
      {allowed && (
        <form
          className="commentform"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            try {
              setError("");
              await api(`/api/videos/${id}/comments`, { method: "POST", json: { body: draft, at: pin ? time : null } });
              setDraft("");
              void load();
            } catch (x) {
              setError((x as Error).message);
            }
          }}
        >
          <textarea placeholder="Add a comment" value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} />
          <div className="row">
            <label className="small">
              <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} /> At {clock(time)}
            </label>
            <span className="grow" />
            <button className="btn small primary" disabled={!draft.trim()}>Comment</button>
          </div>
        </form>
      )}
    </div>
  );
}

/** "0:00 Intro" per line ⇄ chapters. */
function chaptersToText(c: Chapter[]): string {
  return c.map((x) => `${clock(x.t)} ${x.title}`).join("\n");
}

function textToChapters(s: string): Chapter[] {
  return s
    .split("\n")
    .map((line) => /^\s*(\S+)\s+(.+)$/.exec(line))
    .filter((m): m is RegExpExecArray => !!m && parseClock(m[1]) !== null)
    .map((m) => ({ t: parseClock(m[1])!, title: m[2].trim() }));
}

function DetailsDialog({ video, ai, onChange, onClose }: { video: VideoDetail; ai: Ai; onChange: (v: VideoDetail) => void; onClose: () => void }) {
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description);
  const [summary, setSummary] = useState(video.summary);
  const [chapters, setChapters] = useState(chaptersToText(video.chapters));
  const [comments, setComments] = useState(video.allow_comments);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal title="Edit details" onClose={onClose} wide>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            setBusy("save");
            const { video: v } = await api<{ video: VideoDetail }>(`/api/videos/${video.id}`, {
              method: "PATCH",
              json: { title, description, summary, chapters: textToChapters(chapters), allow_comments: comments },
            });
            onChange(v);
            onClose();
          } catch (x) {
            setError((x as Error).message);
          } finally {
            setBusy("");
          }
        }}
      >
        <label>
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
        </label>
        <label>
          <span>Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={5000} />
        </label>
        <label>
          <span>Summary</span>
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} maxLength={5000} />
        </label>
        <label>
          <span>Chapters, one per line: a start time and a title (for example &quot;1:30 Demo&quot;)</span>
          <textarea value={chapters} onChange={(e) => setChapters(e.target.value)} rows={5} placeholder={"0:00 Introduction\n1:30 Demo"} />
        </label>
        {ai.text && (
          <div className="aibox">
            <button
              type="button"
              className="btn small"
              disabled={!!busy || !video.has_captions}
              title={video.has_captions ? "" : "Add captions first; the summary is written from them"}
              onClick={async () => {
                try {
                  setError("");
                  setBusy("ai");
                  const { suggestion } = await api<{ suggestion: { summary: string; chapters: Chapter[] } }>(`/api/videos/${video.id}/summary`, { method: "POST" });
                  setSummary(suggestion.summary);
                  if (suggestion.chapters.length) setChapters(chaptersToText(suggestion.chapters));
                } catch (x) {
                  setError((x as Error).message);
                } finally {
                  setBusy("");
                }
              }}
            >
              <Sparkles size={14} /> {busy === "ai" ? "Writing…" : "Suggest a summary and chapters"}
            </button>
            <span className="muted small">{video.has_captions ? "Written from the transcript. Look it over before you save." : "Needs captions first."}</span>
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={comments} onChange={(e) => setComments(e.target.checked)} /> Allow comments
        </label>
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!!busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

function CaptionsDialog({ video, ai, onChange, onClose }: { video: VideoDetail; ai: Ai; onChange: (v: VideoDetail) => void; onClose: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const act = async (fn: () => Promise<{ video: VideoDetail }>) => {
    try {
      setError("");
      setBusy(true);
      onChange((await fn()).video);
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Captions" onClose={onClose}>
      <div className="form">
        <p>
          {video.captions_status === "working"
            ? "Making captions from the video's speech. This page updates when they're ready; you can close this."
            : video.has_captions
              ? `This video has captions (${video.captions_source === "ai" ? "made automatically" : "from a file"}). They're also its searchable transcript.`
              : "Captions show on the video and become its transcript, which people can read and search."}
        </p>
        {video.captions_status === "failed" && video.captions_error && <p className="error">{video.captions_error}</p>}
        <div className="row wrap">
          <button className="btn" disabled={busy} onClick={() => file.current?.click()}>
            Upload a .vtt or .srt file
          </button>
          <input
            ref={file}
            type="file"
            accept=".vtt,.srt,text/vtt"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void act(async () => api(`/api/videos/${video.id}/captions`, { method: "PUT", body: await f.text() }));
            }}
          />
          {ai.speech && (
            <button
              className="btn"
              disabled={busy || video.status !== "ready" || video.captions_status === "working"}
              onClick={() => {
                if (video.has_captions && !confirm("Replace the current captions with new ones made from the video's speech?")) return;
                void act(() => api(`/api/videos/${video.id}/transcribe`, { method: "POST" }));
              }}
            >
              <Sparkles size={14} /> Make captions automatically
            </button>
          )}
          {video.has_captions && (
            <>
              <a className="btn" href={`/api/videos/${video.id}/captions`} download={`${video.title}.vtt`}>Download</a>
              <button className="btn ghost" disabled={busy} onClick={() => void act(() => api(`/api/videos/${video.id}/captions`, { method: "DELETE" }))}>
                Remove
              </button>
            </>
          )}
        </div>
        {!ai.speech && <p className="muted small">Automatic captions are off. An administrator can turn them on by setting a speech model (AI_SPEECH_MODEL).</p>}
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  );
}
