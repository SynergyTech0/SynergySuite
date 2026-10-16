"use client";
/** Runs an app full screen, scaled to fit the window, as the people it's shared with use it. */
import { useEffect, useMemo, useState } from "react";
import { api, browserAdapter, type AppDetail } from "@/lib/client";
import type { AppDef } from "@/lib/model";
import { AppRuntime } from "@/lib/runtime";
import { Canvas, Toasts, useRuntime } from "./Canvas";

export function Player({ id, draft, user }: { id: string; draft: boolean; user: { email: string; name: string } }) {
  const [app, setApp] = useState<AppDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ app: AppDetail }>(`/api/apps/${encodeURIComponent(id)}`)
      .then((r) => setApp(r.app))
      .catch((e) => setError(e.status === 404 ? "This app doesn't exist, or it hasn't been shared with you." : e.message));
  }, [id]);
  if (error) return <div className="signed-out">{error}</div>;
  if (!app) return <div className="signed-out">Loading…</div>;
  const def = draft && app.draft ? app.draft : app.definition;
  if (!def) {
    return (
      <div className="signed-out">
        This app hasn&apos;t been published yet.{" "}
        {app.draft && (
          <a href={`/play/${id}?draft=1`} className="button">
            Preview the draft
          </a>
        )}
      </div>
    );
  }
  return <Running id={id} def={def} name={app.name} user={user} draft={draft && !!app.draft} />;
}

export function Running({ id, def, name, user, draft, onClose }: { id: string; def: AppDef; name: string; user: { email: string; name: string }; draft?: boolean; onClose?: () => void }) {
  const adapter = useMemo(() => browserAdapter(id), [id]);
  const rt = useMemo(() => new AppRuntime(def, adapter, { user, launch: (url) => window.open(url, "_blank", "noopener,noreferrer") }), [def, adapter, user]);
  useRuntime(rt);
  const [scale, setScale] = useState(1);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    void rt.start().finally(() => setStarted(true));
  }, [rt]);

  useEffect(() => {
    const fit = () => {
      const w = window.innerWidth;
      const h = window.innerHeight - (onClose ? 44 : 48) - 36;
      setScale(Math.min(w / def.width, h / def.height, 2));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [def.width, def.height, onClose]);

  useEffect(() => {
    if (!onClose) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const failing = [...rt.sources.entries()].filter(([, s]) => s.status === "error");
  const screen = rt.screen();
  return (
    <div className={`player${onClose ? " preview" : ""}`}>
      <div className="player-bar">
        <strong>{name}</strong>
        {draft && <span className="badge">Draft preview</span>}
        {(rt.busy > 0 || !started) && <span className="spinner" aria-label="Working" />}
        <span className="grow" />
        {onClose && (
          <button onClick={onClose} title="Close preview (Esc)">
            Close preview
          </button>
        )}
      </div>
      {failing.map(([name, s]) => (
        <div key={name} className="error-bar">
          {name}: {s.error}
          <button onClick={() => void rt.load(name)}>Retry</button>
        </div>
      ))}
      {[...adapter.truncated].map((n) => (
        <div key={n} className="warn-bar">
          {n} has more than 2,000 records; the app works with the first 2,000.
        </div>
      ))}
      <div className="player-stage">
        <div style={{ width: def.width * scale, height: def.height * scale }}>
          <div key={screen.id} className={`tr-${rt.transition.toLowerCase()}`}>
            <div className="screen-wrap" style={{ transform: `scale(${scale})`, transformOrigin: "0 0", width: def.width, height: def.height }}>
              <Canvas rt={rt} screen={screen} />
            </div>
          </div>
        </div>
      </div>
      <Toasts rt={rt} />
    </div>
  );
}
