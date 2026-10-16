"use client";

// Version history for a presentation: named and automatic snapshots, a preview
// of any version's slides, rename, and restore (the current deck is saved as
// a version first, so a restore can itself be undone from here).
import { useCallback, useEffect, useMemo, useState } from "react";
import { prepareSlides } from "@/lib/slides/model";
import { decodeSnapshot, snapshotMasters, snapshotSlides, type DeckSnapshot } from "@/lib/slides/versions";
import { ScaledSlide, type DeckLook } from "./SlideView";

type Version = { id: string; author_name: string; label: string | null; created_ms: string };

const when = (ms: string) => {
  const d = new Date(Number(ms));
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export function VersionPanel({
  docId,
  canEdit,
  save,
  lookFor,
  onRestore,
  onClose,
}: {
  docId: string;
  canEdit: boolean;
  /** save the current deck as a version; resolves to the new version id (or null when unchanged) */
  save: (label?: string) => Promise<string | null>;
  lookFor: (meta: Record<string, string>) => DeckLook;
  onRestore: (s: DeckSnapshot) => void;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [namedOnly, setNamedOnly] = useState(false);
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState<{ id: string; snap: DeckSnapshot } | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/docs/${docId}/versions`).catch(() => null);
    if (res?.ok) setVersions((await res.json()).versions ?? []);
    setLoading(false);
  }, [docId]);
  useEffect(() => {
    load();
  }, [load]);

  const open = async (id: string) => {
    setError("");
    const res = await fetch(`/api/docs/${docId}/versions/${id}`);
    const snap = res.ok ? decodeSnapshot((await res.json()).version?.html) : null;
    if (!snap) {
      setError("This version could not be read.");
      return;
    }
    setPreview({ id, snap });
  };
  const saveNow = async () => {
    const id = await save(draft.trim() || undefined);
    setDraft("");
    await load();
    if (!id) setError("No changes since the last version.");
    else setError("");
  };
  const rename = async (v: Version) => {
    const label = window.prompt("Version name", v.label || "");
    if (label === null) return;
    await fetch(`/api/docs/${docId}/versions/${v.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }) });
    await load();
  };
  const restore = async () => {
    if (!preview) return;
    if (!window.confirm("Restore this version? The current presentation is saved as a version first.")) return;
    await save("Before restore");
    onRestore(preview.snap);
    setPreview(null);
    await load();
  };

  const shown = namedOnly ? versions.filter((v) => v.label) : versions;
  const pv = useMemo(() => {
    if (!preview) return null;
    const look = lookFor(preview.snap.meta);
    return { look, slides: prepareSlides(snapshotSlides(preview.snap), snapshotMasters(preview.snap)) };
  }, [preview, lookFor]);
  const label = preview ? versions.find((v) => v.id === preview.id) : undefined;

  return (
    <aside className="w-80 shrink-0 border-l border-slate-200 bg-white flex flex-col min-h-0 no-print" data-testid="version-panel">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
        <h2 className="text-sm font-semibold text-slate-800">Version history</h2>
        <button type="button" className="ml-auto text-slate-400 hover:text-slate-700" aria-label="Close version history" onClick={onClose}>✕</button>
      </div>
      {preview && pv ? (
        <div className="flex-1 min-h-0 flex flex-col" data-testid="version-preview">
          <div className="px-4 py-2 border-b border-slate-100 text-xs text-slate-600 flex items-center gap-2">
            <button type="button" className="text-indigo-700 hover:underline" onClick={() => setPreview(null)}>← All versions</button>
            <span className="truncate">{label?.label || (label ? when(label.created_ms) : "")}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 bg-slate-50">
            {pv.slides.map((s, i) => (
              <div key={s.id || i} className="flex gap-2 items-start" data-testid="version-slide">
                <span className="text-[11px] text-slate-400 w-4 text-right pt-1">{i + 1}</span>
                <div className="rounded border border-slate-200 overflow-hidden bg-white shadow-sm">
                  <ScaledSlide slide={s} look={pv.look} width={248} />
                </div>
              </div>
            ))}
          </div>
          {canEdit && (
            <div className="p-3 border-t border-slate-200">
              <button type="button" className="w-full rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700" data-testid="version-restore" onClick={restore}>Restore this version</button>
            </div>
          )}
        </div>
      ) : (
        <>
          {canEdit && (
            <div className="p-3 border-b border-slate-100 space-y-2">
              <div className="flex gap-2">
                <input className="flex-1 min-w-0 h-8 rounded border border-slate-300 px-2 text-sm" placeholder="Name this version (optional)" data-testid="version-name" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") saveNow(); }} />
                <button type="button" className="rounded bg-slate-100 px-3 text-sm text-slate-700 hover:bg-slate-200" data-testid="version-save" onClick={saveNow}>Save</button>
              </div>
            </div>
          )}
          <label className="flex items-center gap-2 px-4 py-2 text-xs text-slate-600 border-b border-slate-100">
            <input type="checkbox" data-testid="version-named-only" checked={namedOnly} onChange={(e) => setNamedOnly(e.target.checked)} />Only named versions
          </label>
          {error && <p className="px-4 py-2 text-xs text-amber-700" data-testid="version-error">{error}</p>}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {loading ? (
              <p className="text-xs text-slate-400 p-4 text-center">Loading…</p>
            ) : shown.length === 0 ? (
              <p className="text-xs text-slate-400 p-4 text-center">{namedOnly ? "No named versions." : "No saved versions yet. They’re captured automatically as you edit."}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {shown.map((v) => (
                  <li key={v.id} className="group flex items-start gap-2 px-4 py-2 hover:bg-slate-50" data-testid="version-item" data-label={v.label || ""}>
                    <button type="button" className="flex-1 min-w-0 text-left" onClick={() => open(v.id)}>
                      <div className="text-sm text-slate-800 truncate">{v.label || when(v.created_ms)}</div>
                      <div className="text-xs text-slate-500 truncate">{v.label ? `${when(v.created_ms)} · ` : ""}{v.author_name}</div>
                    </button>
                    {canEdit && <button type="button" className="text-xs text-slate-400 hover:text-indigo-700 opacity-0 group-hover:opacity-100 focus:opacity-100" data-testid="version-rename" onClick={() => rename(v)}>Rename</button>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
