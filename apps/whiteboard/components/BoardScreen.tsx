"use client";
import { ArrowLeft, CloudUpload, Share2, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Board } from "@/lib/boards";
import { type Peer, uniquePeople } from "@/lib/sync";
import { STICKY_COLORS } from "@/lib/templates";
import type { CanvasActions, Status } from "./BoardCanvas";
import { api } from "./client";
import { Modal } from "./Modal";
import { ShareDialog } from "./ShareDialog";

// Excalidraw draws on a <canvas> and reads window at import, so it only ever runs in the browser.
const BoardCanvas = dynamic(() => import("./BoardCanvas"), { ssr: false, loading: () => <p className="pad muted">Loading the board…</p> });

const STATUS_TEXT: Record<Status, string> = {
  connecting: "Connecting…",
  live: "Live",
  offline: "Offline. Your changes sync when you're back.",
  denied: "You no longer have access to this board.",
};

type Me = { email: string; name: string; ai: boolean };

/** One board: its header (name, people, sticky notes, Drive, sharing) over the live canvas. */
export function BoardScreen({ id, me, collabUrl }: { id: string; me: Me; collabUrl: string }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<Status>("connecting");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [toast, setToast] = useState<{ text: string; href?: string } | null>(null);
  const [dialog, setDialog] = useState<"share" | "ideas" | null>(null);
  const [driveMenu, setDriveMenu] = useState(false);
  const [title, setTitle] = useState("");
  const actions = useRef<CanvasActions | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string, href?: string) => {
    setToast({ text, href });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), href ? 8000 : 3500);
  }, []);

  useEffect(() => {
    api<Board>(`/api/boards/${id}`).then(
      (b) => {
        setBoard(b);
        setTitle(b.title);
        document.title = `${b.title} - Synergy Whiteboard`;
      },
      (e) => setError((e as Error).message),
    );
    const close = () => setDriveMenu(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [id]);

  if (error) {
    return (
      <div className="empty">
        <h1>Can&apos;t open this board</h1>
        <p>{error === "Not found" ? "It was deleted, or it isn't shared with you. Ask its owner to share it." : error}</p>
        <a className="btn" href="/">Back to your boards</a>
      </div>
    );
  }
  if (!board) return <p className="pad muted">Opening the board…</p>;

  const canEdit = board.role !== "viewer";
  const faces = uniquePeople(peers).filter((p) => p.email !== me.email);

  async function rename() {
    const t = title.trim();
    if (!board || !t || t === board.title) return setTitle(board?.title ?? "");
    try {
      const b = await api<Board>(`/api/boards/${board.id}`, { method: "PATCH", json: { title: t } });
      setBoard(b);
      document.title = `${b.title} - Synergy Whiteboard`;
    } catch (e) {
      showToast((e as Error).message);
      setTitle(board.title);
    }
  }

  async function saveToDrive(format: "excalidraw" | "png" | "svg") {
    if (!board || !actions.current) return;
    showToast("Saving a copy to Drive…");
    try {
      const blob = await actions.current.exportAs(format);
      const res = await fetch(`/api/boards/${board.id}/drive?format=${format}`, { method: "POST", body: blob, headers: { "Content-Type": blob.type } });
      const data = (await res.json().catch(() => ({}))) as { error?: string; name?: string; url?: string };
      if (!res.ok) throw new Error(data.error || "Couldn't save to Drive");
      showToast(`Saved ${data.name} in Drive › Whiteboards`, data.url);
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  return (
    <div className="board">
      <div className="boardbar">
        <a className="iconbtn" href="/" aria-label="All boards" title="All boards"><ArrowLeft size={18} /></a>
        <input
          className="boardtitle"
          aria-label="Board name"
          value={title}
          disabled={!canEdit}
          size={Math.max(8, Math.min(40, title.length + 1))}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setTitle(board.title);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {!canEdit && <span className="readonly">View only</span>}
        <span className="status" role="status">
          <span className={`dot ${status === "live" ? "live" : status === "connecting" ? "" : "lost"}`} />
          {STATUS_TEXT[status]}
        </span>
        {faces.length > 0 && (
          <span className="faces" aria-label={`Also here: ${faces.map((f) => f.name).join(", ")}`}>
            {faces.slice(0, 6).map((f) => (
              <span key={f.email} className="face" style={{ background: f.color }} title={f.name}>{f.name[0]?.toUpperCase()}</span>
            ))}
            {faces.length > 6 && <span className="face" style={{ background: "#868e96" }}>+{faces.length - 6}</span>}
          </span>
        )}
        {canEdit && (
          <span className="stickies" aria-label="Add a sticky note">
            {STICKY_COLORS.map((c) => (
              <button key={c.id} className="stickybtn" style={{ background: c.fill }} title={`${c.name} sticky note`} aria-label={`Add a ${c.name.toLowerCase()} sticky note`} onClick={() => actions.current?.addSticky(c.id)} />
            ))}
          </span>
        )}
        {canEdit && me.ai && (
          <button className="btn ghost" onClick={() => setDialog("ideas")} title="Sticky-note ideas from AI">
            <Sparkles size={16} /> Ideas
          </button>
        )}
        <span className="menuwrap">
          <button className="btn ghost" aria-expanded={driveMenu} onClick={(e) => { e.stopPropagation(); setDriveMenu((v) => !v); }}>
            <CloudUpload size={16} /> Save to Drive
          </button>
          {driveMenu && (
            <div className="menu">
              <button onClick={() => saveToDrive("excalidraw")}>Board file (.excalidraw)</button>
              <button onClick={() => saveToDrive("png")}>Picture (.png)</button>
              <button onClick={() => saveToDrive("svg")}>Drawing (.svg)</button>
            </div>
          )}
        </span>
        <button className="btn primary" onClick={() => setDialog("share")}>
          <Share2 size={16} /> Share
        </button>
      </div>
      <div className="canvas">
        <BoardCanvas
          board={board}
          me={me}
          collabUrl={collabUrl}
          readOnly={!canEdit || status === "denied"}
          onStatus={setStatus}
          onPeers={setPeers}
          onReady={(a) => (actions.current = a)}
          onToast={showToast}
        />
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast.text}
          {toast.href && <a className="linkbtn light" href={toast.href} target="_blank" rel="noreferrer">Open in Drive</a>}
        </div>
      )}
      {dialog === "share" && (
        <ShareDialog
          board={board}
          me={me.email}
          onClose={() => setDialog(null)}
          onChanged={async () => setBoard(await api<Board>(`/api/boards/${board.id}`))}
        />
      )}
      {dialog === "ideas" && <IdeasDialog words={() => actions.current?.words() ?? ""} onAdd={(ideas) => actions.current?.addIdeas(ideas)} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** Ask the suite's AI model for sticky-note ideas, see them, then add them to the board. */
function IdeasDialog({ words, onAdd, onClose }: { words: () => string; onAdd: (ideas: string[]) => void; onClose: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [ideas, setIdeas] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title="Ideas from AI" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            setIdeas((await api<{ ideas: string[] }>("/api/ai/ideas", { method: "POST", json: { prompt, onBoard: words() } })).ideas);
          } catch (x) {
            setError((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          <span>What should the ideas be about?</span>
          <textarea className="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ways to welcome new starters in their first week" autoFocus required />
        </label>
        <p className="error" role="alert">{error}</p>
        {ideas && (ideas.length ? <ul className="ideas">{ideas.map((i, n) => <li key={n}>{i}</li>)}</ul> : <p className="muted">No ideas came back. Try asking differently.</p>)}
        <div className="actions">
          <button type="submit" className="btn" disabled={busy || !prompt.trim()}>{busy ? "Thinking…" : ideas ? "Try again" : "Get ideas"}</button>
          <button
            type="button"
            className="btn primary"
            disabled={!ideas?.length}
            onClick={() => {
              onAdd(ideas ?? []);
              onClose();
            }}
          >
            Add {ideas?.length || ""} sticky notes
          </button>
        </div>
      </form>
    </Modal>
  );
}
