"use client";
import { ArrowLeft, FolderOpen, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { clock } from "@/lib/captions";
import { type EditorSave, asEngineMessage, saveKind } from "@/lib/bridge";
import type { Project } from "@/lib/projects";
import type { VideoCard, VideoDetail } from "@/lib/videos";
import { api } from "./client";
import { Modal } from "./Modal";

/** What the FilmCraft page puts on its window (see apps/filmcraft-web/src/api.rs upstream). */
type FilmCraft = {
  importUrl(url: string, name?: string): Promise<{ items?: unknown[]; errors?: string[] }>;
  openProject(file: File): Promise<unknown>;
  execute(command: string, params?: Record<string, unknown>): Promise<unknown>;
};
type EngineWindow = Window & { filmcraft?: FilmCraft; File: typeof File };

/**
 * The video editor: FilmCraft in an iframe (same origin, opened with `?host`). Library videos go in
 * through `window.filmcraft.importUrl`; whatever the editor writes comes back here as a message.
 * Exported videos join the library, saved projects are kept on the Editor projects shelf, and
 * anything else (captions, frames) downloads as usual.
 */
export function Editor({ videoId, projectId }: { videoId: string | null; projectId: string | null }) {
  const frame = useRef<HTMLIFrameElement>(null);
  /** Library videos brought into this session, in order: a saved project remembers them. */
  const imported = useRef<string[]>([]);
  const project = useRef<Project | null>(null);
  const [name, setName] = useState("New video");
  const [status, setStatus] = useState("Loading the editor…");
  const [saved, setSaved] = useState<{ id: string; title: string } | null>(null);
  const [picking, setPicking] = useState(false);

  const engine = () => (frame.current?.contentWindow as EngineWindow | null) ?? null;

  const importVideo = useCallback(async (id: string) => {
    const fc = engine()?.filmcraft;
    if (!fc) throw new Error("The editor isn't ready");
    const v = (await api<{ video: VideoDetail }>(`/api/videos/${id}`)).video;
    setStatus(`Adding ${v.title}…`);
    // The original upload, not the playback copy: the editor gets the best quality there is. Its
    // file name stays the same each time, so a reopened project finds its clips again.
    const res = await fc.importUrl(`/api/videos/${id}/media?original`, v.source_name);
    if (!imported.current.includes(id)) imported.current.push(id);
    setStatus("");
    return { ...res, video: v };
  }, []);

  const onReady = useCallback(async () => {
    try {
      if (projectId) {
        const p = (await api<{ project: Project }>(`/api/projects/${projectId}`)).project;
        project.current = p;
        setName(p.name.replace(/\.fcproj$/i, ""));
        // Bring the project's videos back first, under the names they had, so its clips find them.
        for (const id of p.video_ids) await importVideo(id).catch(() => {});
        setStatus(`Opening ${p.name}…`);
        const bytes = await (await fetch(`/api/projects/${p.id}/file`)).arrayBuffer();
        const w = engine()!;
        // The engine checks for its own window's File type.
        await w.filmcraft!.openProject(new w.File([bytes], p.name));
        setStatus("");
      } else if (videoId) {
        const res = await importVideo(videoId);
        setName(res.video.title);
        // Start with it on a timeline of its own size, ready to cut.
        if (res.items?.length) await engine()?.filmcraft?.execute("file.newSequenceFromClip", { items: [res.items[0]] }).catch(() => {});
      } else {
        setStatus("");
      }
    } catch (e) {
      setStatus((e as Error).message);
    }
  }, [importVideo, projectId, videoId]);

  const onSave = useCallback(async (msg: EditorSave) => {
    const kind = saveKind(msg.name);
    try {
      if (kind === "video") {
        setStatus(`Saving ${msg.name} to your videos…`);
        const { video } = await api<{ video: VideoCard }>(`/api/videos?name=${encodeURIComponent(msg.name)}&origin=editor`, {
          method: "POST",
          body: msg.bytes,
        });
        setSaved({ id: video.id, title: video.title });
        setStatus("");
      } else if (kind === "project") {
        const videos = encodeURIComponent(imported.current.join(","));
        setStatus(`Saving ${msg.name}…`);
        const p = project.current
          ? (await api<{ project: Project }>(`/api/projects/${project.current.id}?videos=${videos}`, { method: "PUT", body: msg.bytes })).project
          : (await api<{ project: Project }>(`/api/projects?name=${encodeURIComponent(msg.name)}&videos=${videos}`, { method: "POST", body: msg.bytes })).project;
        if (!project.current) history.replaceState(null, "", `/edit?project=${p.id}`);
        project.current = p;
        setName(p.name.replace(/\.fcproj$/i, ""));
        setStatus(`Saved ${p.name.replace(/\.fcproj$/i, "")} to your editor projects`);
      } else {
        // Captions, frames, interchange files: a normal download.
        const url = URL.createObjectURL(new Blob([msg.bytes]));
        const a = document.createElement("a");
        a.href = url;
        a.download = msg.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
    } catch (e) {
      setStatus(`Couldn't save ${msg.name}: ${(e as Error).message}. Your work is still open here.`);
    }
  }, []);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return;
      const msg = asEngineMessage(e.data);
      if (!msg) return;
      if (msg.type === "filmcraft:ready") void onReady();
      else void onSave(msg);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onReady, onSave]);

  return (
    <main className="editor">
      <div className="bar">
        <a href="/" className="btn small dark ghost">
          <ArrowLeft size={15} /> Stream
        </a>
        <span className="file">{name}</span>
        <button className="btn small dark ghost" onClick={() => setPicking(true)}>
          <Plus size={15} /> Add from your videos
        </button>
        <a href="/#projects" className="btn small dark ghost">
          <FolderOpen size={15} /> Projects
        </a>
        <span className="status" role="status">
          {saved ? (
            <>
              Saved to your videos: <a href={`/watch/${saved.id}`} target="_blank" rel="noreferrer">{saved.title}</a>
              <button className="linkbtn" onClick={() => setSaved(null)} aria-label="Dismiss">×</button>
            </>
          ) : (
            status
          )}
        </span>
        <span className="hint">Export (File ▸ Export ▸ Media) saves to your videos. Save keeps the project.</span>
      </div>
      <iframe ref={frame} src="/engine/index.html?host" title="Video editor" allow="fullscreen; clipboard-read; clipboard-write; autoplay" />
      {picking && (
        <VideoPicker
          onClose={() => setPicking(false)}
          onPick={(v) => {
            setPicking(false);
            void importVideo(v.id).catch((e: Error) => setStatus(e.message));
          }}
        />
      )}
    </main>
  );
}

function VideoPicker({ onPick, onClose }: { onPick: (v: VideoCard) => void; onClose: () => void }) {
  const [videos, setVideos] = useState<VideoCard[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all(["mine", "shared", "org"].map((s) => api<{ videos: VideoCard[] }>(`/api/videos?shelf=${s}`).then((r) => r.videos)))
      .then((lists) => {
        const seen = new Set<string>();
        setVideos(lists.flat().filter((v) => v.status === "ready" && !seen.has(v.id) && seen.add(v.id)));
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  return (
    <Modal title="Add a video from Stream" onClose={onClose} wide>
      <div className="form">
        <p className="error">{error}</p>
        {videos === null ? (
          <p className="muted">Loading…</p>
        ) : videos.length === 0 ? (
          <p className="muted">No videos yet. You can also drop files from your computer straight onto the editor.</p>
        ) : (
          <div className="pickgrid">
            {videos.map((v) => (
              <button key={v.id} className="pick" onClick={() => onPick(v)}>
                <img src={`/api/videos/${v.id}/poster`} alt="" loading="lazy" />
                <span className="fname">{v.title}</span>
                {v.duration ? <span className="muted small">{clock(v.duration)}</span> : null}
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
