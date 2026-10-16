"use client";
import { useEffect, useRef, useState } from "react";
import { clock } from "@/lib/captions";
import type { SharedVideo } from "@/lib/videos";
import { api, dayLabel, person } from "./client";

function useShared(token: string) {
  const [video, setVideo] = useState<SharedVideo | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ video: SharedVideo }>(`/api/shared/${token}`).then((r) => setVideo(r.video)).catch((e: Error) => setError(e.message));
  }, [token]);
  return { video, error };
}

function Player({ token, video, className }: { token: string; video: SharedVideo; className?: string }) {
  const counted = useRef(false);
  const ref = useRef<HTMLVideoElement>(null);
  if (video.status !== "ready") return <div className="placeholder">This video is still being processed. Try again in a few minutes.</div>;
  return (
    <video
      ref={ref}
      className={className}
      controls
      playsInline
      preload="metadata"
      poster={`/api/shared/${token}/poster`}
      src={`/api/shared/${token}/media`}
      onPlay={() => {
        if (counted.current) return;
        counted.current = true;
        void fetch(`/api/shared/${token}/view`, { method: "POST" }).catch(() => {});
      }}
    >
      {video.has_captions && <track kind="captions" src={`/api/shared/${token}/captions`} srcLang="en" label="Captions" />}
    </video>
  );
}

/** A video opened through its link: the player, its details and chapters. No account needed. */
export function SharedWatch({ token }: { token: string }) {
  const { video, error } = useShared(token);
  const box = useRef<HTMLDivElement>(null);
  if (error) return <div className="pad"><h1>{error}</h1><p className="muted">Ask whoever sent it for a new link.</p></div>;
  if (!video) return <p className="pad muted">Loading…</p>;
  const seek = (t: number) => {
    const v = box.current?.querySelector("video");
    if (v) {
      v.currentTime = t;
      void v.play().catch(() => {});
    }
  };
  return (
    <div className="watch shared">
      <section className="stage">
        <div className="playerbox" ref={box}>
          <Player token={token} video={video} />
        </div>
        <div className="meta">
          <h1>{video.title}</h1>
          <p className="muted">{person(video.owner)} · {dayLabel(video.created_at)}</p>
          {video.summary && <p className="summary">{video.summary}</p>}
          {video.description && <p className="description">{video.description}</p>}
        </div>
      </section>
      {video.chapters.length > 0 && (
        <aside className="side">
          <ol className="panel chapters">
            {video.chapters.map((c) => (
              <li key={c.t}>
                <button onClick={() => seek(c.t)}><span className="stamp">{clock(c.t)}</span> {c.title}</button>
              </li>
            ))}
          </ol>
        </aside>
      )}
    </div>
  );
}

/** Only the player, filling its frame, for embedding on other pages. */
export function EmbedPlayerInner({ token }: { token: string }) {
  const { video, error } = useShared(token);
  if (error) return <div className="embedmsg">{error}</div>;
  if (!video) return null;
  return <Player token={token} video={video} className="embedvideo" />;
}
