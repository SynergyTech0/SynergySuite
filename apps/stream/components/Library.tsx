"use client";
import { Building2, Clapperboard, Film, Info, Lock, Search, Share2, Upload, Users, Video, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { clock } from "@/lib/captions";
import type { Project } from "@/lib/projects";
import type { Shelf, VideoCard } from "@/lib/videos";
import { api, dayLabel, person, upload, viewsLabel } from "./client";
import { Modal } from "./Modal";

type Uploading = { key: number; name: string; fraction: number; error?: string; cancel: () => void };

const SHELVES: { id: Shelf | "projects"; label: string; icon: React.ReactNode }[] = [
  { id: "mine", label: "My videos", icon: <Video size={16} /> },
  { id: "shared", label: "Shared with me", icon: <Users size={16} /> },
  { id: "org", label: "Organization", icon: <Building2 size={16} /> },
  { id: "projects", label: "Editor projects", icon: <Clapperboard size={16} /> },
];

/** The home page: the library's shelves, uploads with progress, and ways to record or edit. */
export function Library({ me }: { me: string }) {
  const [shelf, setShelf] = useState<Shelf | "projects">("mine");
  const [filter, setFilter] = useState("");
  const [videos, setVideos] = useState<VideoCard[] | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [uploads, setUploads] = useState<Uploading[]>([]);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [about, setAbout] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const keyRef = useRef(0);

  // The editor links to /#projects.
  useEffect(() => {
    if (location.hash === "#projects") setShelf("projects");
  }, []);

  const load = useCallback(async () => {
    try {
      setError("");
      if (shelf === "projects") {
        setProjects((await api<{ projects: Project[] }>("/api/projects")).projects);
      } else {
        const p = new URLSearchParams({ shelf, q: filter });
        setVideos((await api<{ videos: VideoCard[] }>(`/api/videos?${p}`)).videos);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [shelf, filter]);

  useEffect(() => {
    const t = setTimeout(load, filter ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, filter]);

  // While anything is processing, look again every few seconds.
  const busy = videos?.some((v) => v.status === "processing");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [busy, load]);

  function send(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const key = ++keyRef.current;
      const job = upload<{ video: VideoCard }>(`/api/videos?name=${encodeURIComponent(file.name)}`, file, (fraction) =>
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, fraction } : x))),
      );
      setUploads((u) => [...u, { key, name: file.name, fraction: 0, cancel: job.cancel }]);
      job.done
        .then(() => {
          setUploads((u) => u.filter((x) => x.key !== key));
          if (shelf !== "mine") setShelf("mine");
          else void load();
        })
        .catch((e: Error) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, error: e.message } : x))));
    }
  }

  return (
    <div
      className={`library${dragging ? " dragging" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) send(e.dataTransfer.files);
      }}
    >
      <nav className="nav">
        <div className="create">
          <button className="btn primary newbtn" onClick={() => input.current?.click()}>
            <Upload size={16} /> Upload
          </button>
          <a className="btn newbtn" href="/record">
            <Film size={16} /> Record
          </a>
          <a className="btn newbtn" href="/edit">
            <Clapperboard size={16} /> Create a video
          </a>
          <input ref={input} type="file" accept="video/*,.mkv,.mts,.m2ts" multiple hidden onChange={(e) => e.target.files && send(e.target.files)} />
        </div>
        {SHELVES.map((s) => (
          <button key={s.id} className={`navitem${shelf === s.id ? " active" : ""}`} onClick={() => setShelf(s.id)}>
            {s.icon} {s.label}
          </button>
        ))}
        <span className="grow" />
        <button className="navitem muted" onClick={() => setAbout(true)}>
          <Info size={16} /> About Stream
        </button>
      </nav>

      <main className="shelf">
        <div className="shelfhead">
          <h1>{SHELVES.find((s) => s.id === shelf)?.label}</h1>
          {shelf !== "projects" && (
            <label className="searchbox">
              <Search size={15} />
              <input placeholder="Search titles and transcripts" value={filter} onChange={(e) => setFilter(e.target.value)} />
              {filter && (
                <button className="iconbtn small" aria-label="Clear" onClick={() => setFilter("")}>
                  <X size={14} />
                </button>
              )}
            </label>
          )}
        </div>
        <p className="error" role="alert">{error}</p>

        {uploads.length > 0 && (
          <ul className="uploads">
            {uploads.map((u) => (
              <li key={u.key}>
                <span className="fname">{u.name}</span>
                {u.error ? <span className="error">{u.error}</span> : <progress max={1} value={u.fraction} />}
                <button
                  className="iconbtn small"
                  aria-label={u.error ? "Dismiss" : "Cancel upload"}
                  onClick={() => {
                    if (!u.error) u.cancel();
                    setUploads((x) => x.filter((y) => y.key !== u.key));
                  }}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {shelf === "projects" ? (
          <Projects projects={projects} onChange={load} />
        ) : videos === null ? (
          <p className="muted">Loading…</p>
        ) : videos.length === 0 ? (
          <Empty shelf={shelf} filtered={!!filter} />
        ) : (
          <div className="grid">
            {videos.map((v) => (
              <VideoTile key={v.id} v={v} me={me} showOwner={shelf !== "mine"} />
            ))}
          </div>
        )}
      </main>
      {dragging && <div className="dropzone">Drop videos to upload them</div>}
      {about && <About onClose={() => setAbout(false)} />}
    </div>
  );
}

/** Credit for the open source engines Stream is built on. */
function About({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="About Synergy Stream" onClose={onClose}>
      <div className="form">
        <p>Synergy Stream is part of Synergy, an open source office suite (AGPL-3.0).</p>
        <p>
          The video editor is <a href="https://github.com/storytold/filmcraft" target="_blank" rel="noreferrer">FilmCraft</a> by the
          FilmCraft contributors, used under the MIT and Apache 2.0 licenses (<a href="/engine/licenses/LICENSE-MIT" target="_blank">MIT</a>,{" "}
          <a href="/engine/licenses/LICENSE-APACHE" target="_blank">Apache 2.0</a>, <a href="/engine/licenses/NOTICE" target="_blank">notice</a>,{" "}
          <a href="/engine/licenses/ATTRIBUTION.md" target="_blank">attributions</a>). FilmCraft is a trademark of its owners; Synergy is not affiliated with them.
        </p>
        <p>
          Videos are made ready to play with <a href="https://ffmpeg.org" target="_blank" rel="noreferrer">FFmpeg</a> (LGPL/GPL), which runs on the server as a separate program.
        </p>
        <div className="actions">
          <button className="btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}

function VideoTile({ v, me, showOwner }: { v: VideoCard; me: string; showOwner: boolean }) {
  return (
    <a className="tile" href={`/watch/${v.id}`}>
      <div className="thumb">
        {v.status !== "failed" && v.progress > 0 && <img src={`/api/videos/${v.id}/poster`} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = "none")} />}
        {v.status === "processing" && <span className="badge">Processing {v.progress ? `${v.progress}%` : "…"}</span>}
        {v.status === "failed" && <span className="badge bad">Couldn&apos;t process</span>}
        {v.status === "ready" && v.duration ? <span className="duration">{clock(v.duration)}</span> : null}
      </div>
      <div className="tilebody">
        <div className="tiletitle" title={v.title}>{v.title}</div>
        <div className="muted small">
          {showOwner && <>{person(v.owner, me)} · </>}
          {viewsLabel(v.views)} · {dayLabel(v.created_at)}
          {v.owner === me && (
            <span className="vis" title={v.visibility === "org" ? "Everyone in the organization" : v.shared ? "Shared" : "Only you"}>
              {v.visibility === "org" ? <Building2 size={12} /> : v.shared ? <Share2 size={12} /> : <Lock size={12} />}
            </span>
          )}
        </div>
      </div>
    </a>
  );
}

function Empty({ shelf, filtered }: { shelf: Shelf; filtered: boolean }) {
  if (filtered) return <p className="muted">No videos match that.</p>;
  if (shelf === "shared") return <p className="muted">Videos people share with you show up here.</p>;
  if (shelf === "org") return <p className="muted">Videos anyone in your organization can watch show up here.</p>;
  return (
    <div className="empty">
      <Video size={40} />
      <h2>No videos yet</h2>
      <p className="muted">Upload a video, drop files anywhere on this page, record your screen or camera, or put a video together in the editor.</p>
    </div>
  );
}

function Projects({ projects, onChange }: { projects: Project[] | null; onChange: () => void }) {
  if (projects === null) return <p className="muted">Loading…</p>;
  if (!projects.length) return <p className="muted">Projects you save in the video editor show up here, to pick up where you left off.</p>;
  return (
    <ul className="rows">
      {projects.map((p) => (
        <li key={p.id}>
          <Clapperboard size={18} />
          <a className="fname" href={`/edit?project=${p.id}`}>{p.name.replace(/\.fcproj$/i, "")}</a>
          <span className="muted small">Saved {dayLabel(p.modified_at)}</span>
          <button
            className="btn small ghost"
            onClick={async () => {
              if (!confirm(`Delete the project "${p.name}"? Videos it used stay in your library.`)) return;
              await api(`/api/projects/${p.id}`, { method: "DELETE" }).catch((e: Error) => alert(e.message));
              onChange();
            }}
          >
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
}
