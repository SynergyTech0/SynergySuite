"use client";
import { FilePlus2, FolderOpen, Image as ImageIcon, MoreHorizontal, Plus, Search, Share2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Board } from "@/lib/boards";
import { TEMPLATES } from "@/lib/templates";
import { ago, api, person } from "./client";
import { Confirm, Prompt } from "./Modal";
import { ShareDialog } from "./ShareDialog";

type Tab = "all" | "mine" | "shared";
type Me = { email: string; name: string };

/** The board list: start a board (blank or from a template), open a file, and find boards. */
export function BoardsHome({ me }: { me: Me }) {
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: "rename" | "delete" | "leave" | "share"; board: Board } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setBoards((await api<{ boards: Board[] }>("/api/boards")).boards);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const close = () => setMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [load]);

  async function create(template?: string) {
    setBusy(true);
    setError("");
    try {
      const t = TEMPLATES.find((x) => x.id === template);
      const b = await api<Board>("/api/boards", { method: "POST", json: { title: t ? t.name : "Untitled board", template: t?.id } });
      location.href = `/b/${b.id}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function openFile(file: File) {
    setBusy(true);
    setError("");
    try {
      const b = await api<Board>("/api/import", { method: "POST", json: { title: file.name.replace(/\.(excalidraw|json)$/i, ""), content: await file.text() } });
      location.href = `/b/${b.id}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const shown = (boards ?? []).filter((b) => {
    if (tab === "mine" && b.owner !== me.email) return false;
    if (tab === "shared" && b.owner === me.email) return false;
    return !query.trim() || b.title.toLowerCase().includes(query.trim().toLowerCase());
  });

  return (
    <div className="home">
      <div className="homehead">
        <h1>Whiteboard</h1>
        <label className="search">
          <Search size={16} />
          <input placeholder="Search boards" aria-label="Search boards" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button className="btn" disabled={busy} onClick={() => fileInput.current?.click()}>
          <Upload size={16} /> Open file
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".excalidraw,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void openFile(f);
          }}
        />
        <button className="btn primary" disabled={busy} onClick={() => create()}>
          <Plus size={16} /> New board
        </button>
      </div>

      <section className="templates" aria-label="Start from a template">
        <button className="tpl" disabled={busy} onClick={() => create()}>
          <span className="art"><FilePlus2 size={28} /></span>
          <b>Blank board</b>
          <span className="small muted">An empty canvas</span>
        </button>
        {TEMPLATES.map((t) => (
          <button key={t.id} className="tpl" disabled={busy} onClick={() => create(t.id)}>
            <span className="art"><TemplateArt id={t.id} /></span>
            <b>{t.name}</b>
            <span className="small muted">{t.description}</span>
          </button>
        ))}
      </section>

      <p className="error" role="alert">{error}</p>

      <div className="tabs" role="tablist">
        {(["all", "mine", "shared"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "all" ? "All boards" : t === "mine" ? "My boards" : "Shared with me"}
          </button>
        ))}
      </div>

      {boards === null ? (
        <p className="muted">Loading boards…</p>
      ) : shown.length === 0 ? (
        <div className="empty">
          <FolderOpen size={40} />
          <p>{query ? "No boards match that." : tab === "shared" ? "Boards people share with you show up here." : "Start a board above. Everyone you share it with can draw on it at the same time."}</p>
        </div>
      ) : (
        <div className="grid">
          {shown.map((b) => (
            <div key={b.id} className="card">
              <a href={`/b/${b.id}`}>
                <div className="thumb">
                  {b.hasThumbnail ? <img src={`/api/boards/${b.id}/thumbnail?v=${encodeURIComponent(b.modifiedAt)}`} alt="" /> : <ImageIcon size={40} />}
                </div>
                <div className="cardbody">
                  <b title={b.title}>{b.title}</b>
                  <span className="small muted">
                    {b.owner === me.email ? "" : `${person(b.owner, me.email)} · `}Edited {ago(b.modifiedAt)}
                    {b.shared && <Share2 size={12} style={{ marginLeft: 6, verticalAlign: -1 }} aria-label="Shared" />}
                  </span>
                </div>
              </a>
              <div className="cardmenu menuwrap">
                <button
                  className="iconbtn"
                  aria-label={`More for ${b.title}`}
                  aria-expanded={menu === b.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenu(menu === b.id ? null : b.id);
                  }}
                >
                  <MoreHorizontal size={18} />
                </button>
                {menu === b.id && (
                  <div className="menu" style={{ top: "auto", bottom: 34 }}>
                    <a href={`/b/${b.id}`}>Open</a>
                    {b.role !== "viewer" && <button onClick={() => setDialog({ kind: "rename", board: b })}>Rename</button>}
                    <button onClick={() => setDialog({ kind: "share", board: b })}>Share</button>
                    <hr />
                    {b.role === "owner" ? (
                      <button className="dangertext" onClick={() => setDialog({ kind: "delete", board: b })}>Delete</button>
                    ) : (
                      <button onClick={() => setDialog({ kind: "leave", board: b })}>Remove from my list</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {dialog?.kind === "rename" && (
        <Prompt
          title="Rename board"
          label="Name"
          initial={dialog.board.title}
          action="Rename"
          onClose={() => setDialog(null)}
          onSubmit={async (title) => {
            await api(`/api/boards/${dialog.board.id}`, { method: "PATCH", json: { title } });
            await load();
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <Confirm
          title="Delete board?"
          message={<>“{dialog.board.title}” will be deleted for everyone it&apos;s shared with.</>}
          action="Delete"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api(`/api/boards/${dialog.board.id}`, { method: "DELETE" });
            await load();
          }}
        />
      )}
      {dialog?.kind === "leave" && (
        <Confirm
          title="Remove from your list?"
          message={<>You won&apos;t see “{dialog.board.title}” any more unless it&apos;s shared with you again.</>}
          action="Remove"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api(`/api/boards/${dialog.board.id}/members?email=${encodeURIComponent(me.email)}`, { method: "DELETE" });
            await load();
          }}
        />
      )}
      {dialog?.kind === "share" && <ShareDialog board={dialog.board} me={me.email} onClose={() => setDialog(null)} onChanged={load} />}
    </div>
  );
}

/** A tiny drawing of each template for its card. */
function TemplateArt({ id }: { id: string }) {
  const note = (x: number, y: number, fill: string) => <rect key={`${x}-${y}`} x={x} y={y} width="14" height="14" rx="2" fill={fill} />;
  switch (id) {
    case "kanban":
    case "retro":
    case "weekly": {
      const cols = id === "weekly" ? 5 : 3;
      const w = 84 / cols;
      return (
        <svg width="96" height="52" viewBox="0 0 96 52" aria-hidden>
          {Array.from({ length: cols }, (_, i) => (
            <g key={i}>
              <rect x={6 + i * w} y="4" width={w - 4} height="44" rx="3" fill="#e9ecef" />
              {note(8 + i * w, 12, ["#ffec99", "#ffc9c9", "#b2f2bb", "#a5d8ff", "#d0bfff"][i])}
            </g>
          ))}
        </svg>
      );
    }
    case "swot":
      return (
        <svg width="96" height="52" viewBox="0 0 96 52" aria-hidden>
          <rect x="22" y="2" width="25" height="23" rx="3" fill="#d3f9d8" />
          <rect x="49" y="2" width="25" height="23" rx="3" fill="#ffe3e3" />
          <rect x="22" y="27" width="25" height="23" rx="3" fill="#d0ebff" />
          <rect x="49" y="27" width="25" height="23" rx="3" fill="#fff3bf" />
        </svg>
      );
    case "mindmap":
      return (
        <svg width="96" height="52" viewBox="0 0 96 52" aria-hidden stroke="#868e96">
          {[[14, 10], [82, 10], [14, 42], [82, 42], [48, 4], [48, 48]].map(([x, y], i) => <line key={i} x1="48" y1="26" x2={x} y2={y} />)}
          <ellipse cx="48" cy="26" rx="16" ry="9" fill="#d0bfff" stroke="none" />
          {[[14, 10], [82, 10], [14, 42], [82, 42]].map(([x, y], i) => <rect key={i} x={x - 8} y={y - 5} width="16" height="10" rx="2" fill="#ffec99" stroke="none" />)}
        </svg>
      );
    case "flowchart":
      return (
        <svg width="96" height="52" viewBox="0 0 96 52" aria-hidden stroke="#495057" fill="none">
          <ellipse cx="20" cy="26" rx="12" ry="8" fill="#b2f2bb" />
          <rect x="38" y="18" width="20" height="16" rx="2" fill="#a5d8ff" />
          <path d="M76 14 L88 26 L76 38 L64 26 Z" fill="#ffec99" />
          <path d="M32 26 H38 M58 26 H64" />
        </svg>
      );
    default:
      return (
        <svg width="96" height="52" viewBox="0 0 96 52" aria-hidden>
          <rect x="16" y="4" width="64" height="12" rx="3" fill="#d0ebff" />
          {note(16, 22, "#ffec99")}
          {note(33, 22, "#ffc9c9")}
          {note(50, 22, "#b2f2bb")}
          {note(67, 22, "#a5d8ff")}
        </svg>
      );
  }
}
