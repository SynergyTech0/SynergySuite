"use client";

// The Google-Docs-style top chrome shared by every editor in the suite (docs,
// sheets, slides): app icon, editable title, star, saved status, the menu bar,
// and the Share button — so all three look identical. App-specific menus and
// any extra right-side controls are passed in.
import { useEffect, useRef, useState } from "react";
import MenuBar, { type Menu } from "./MenuBar";
import ShareDialog from "./ShareDialog";
import NotificationBell from "./NotificationBell";

export type Role = "viewer" | "commenter" | "editor" | "owner";

export default function AppTitleBar({
  docId,
  icon = "📄",
  initialTitle,
  title: titleProp,
  initialStarred = false,
  role,
  meEmail,
  menus,
  status = null,
  peers = 1,
  onTitle,
  rightExtra,
  shareOpen,
  onShareOpen,
}: {
  docId: string;
  icon?: string;
  initialTitle: string;
  /** Current title when it changes elsewhere (file import, a collaborator's rename). */
  title?: string;
  initialStarred?: boolean;
  role: Role;
  meEmail: string;
  menus: Menu[];
  status?: "connecting" | "connected" | "offline" | null;
  peers?: number;
  onTitle?: (t: string) => void;
  rightExtra?: React.ReactNode;
  shareOpen: boolean;
  onShareOpen: (v: boolean) => void;
}) {
  const canEdit = role === "editor" || role === "owner";
  const roleLabel = role === "owner" ? "Owner" : role === "editor" ? "Editor" : role === "commenter" ? "Can comment" : "View only";
  const [title, setTitle] = useState(initialTitle);
  useEffect(() => {
    if (titleProp !== undefined) setTitle(titleProp);
  }, [titleProp]);
  const [starred, setStarred] = useState(initialStarred);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveTitle = (t: string) => {
    setTitle(t);
    onTitle?.(t);
    if (!canEdit) return;
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      fetch(`/api/docs/${docId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: t }) }).catch(() => {});
    }, 600);
  };
  const toggleStar = () => {
    const v = !starred;
    setStarred(v);
    fetch(`/api/docs/${docId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ starred: v }) }).catch(() => setStarred(!v));
  };

  return (
    <div className="px-3 pt-2 flex items-center gap-2">
      <a href="/" title="Home" className="text-xl leading-none">{icon}</a>
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-1.5">
          <input
            value={title}
            onChange={(e) => saveTitle(e.target.value)}
            readOnly={!canEdit}
            placeholder="Untitled"
            className="text-[18px] text-slate-800 outline-none rounded px-1 -ml-1 hover:bg-slate-100 focus:bg-white focus:ring-1 focus:ring-indigo-300 min-w-[6rem] max-w-[22rem] truncate"
          />
          <button onClick={toggleStar} title={starred ? "Starred" : "Star"} className="text-slate-400 hover:text-amber-500 leading-none">
            {starred ? "★" : "☆"}
          </button>
          {status && (
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 ml-1">
              <span className={`w-1.5 h-1.5 rounded-full ${status === "connected" ? "bg-emerald-500" : status === "connecting" ? "bg-amber-400" : "bg-slate-300"}`} />
              {status === "connected" ? "Saved" : status === "connecting" ? "…" : "Offline"}
            </span>
          )}
        </div>
        <MenuBar menus={menus} />
      </div>
      <div className="ml-auto flex items-center gap-2 text-xs">
        {peers > 1 && <span className="text-slate-500">{peers} online</span>}
        {rightExtra}
        <NotificationBell />
        {canEdit ? (
          <button onClick={() => onShareOpen(true)} className="text-[13px] rounded-full px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium inline-flex items-center gap-1.5">🔒 Share</button>
        ) : (
          <span className="text-[11px] rounded-full px-2.5 py-1 bg-slate-100 text-slate-600 border border-slate-200">{roleLabel}</span>
        )}
      </div>
      {shareOpen && <ShareDialog docId={docId} meEmail={meEmail} onClose={() => onShareOpen(false)} />}
    </div>
  );
}
