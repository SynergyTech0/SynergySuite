"use client";
import { ChevronRight, Folder, HardDrive, Library as LibIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { type Crumb, type Item, type Library, type Role, api } from "./client";

type Here = { parent?: string; library?: string } | null;

/** Pick a folder to move or copy into: My files, a library, or a folder inside either. */
export function FolderPicker({
  title, action, libraries, moving, onPick, onClose,
}: {
  title: string; action: string; libraries: Library[]; moving: Item[];
  onPick: (target: { parent?: string; library?: string }) => Promise<void>; onClose: () => void;
}) {
  const [here, setHere] = useState<Here>({});
  const [list, setList] = useState<{ items: Item[]; crumbs: Crumb[]; role: Role } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!here) return;
    setList(null);
    const qs = new URLSearchParams({ view: "folders" });
    if (here.parent) qs.set("parent", here.parent);
    if (here.library) qs.set("library", here.library);
    api<{ items: Item[]; crumbs: Crumb[]; role: Role }>(`/api/items?${qs}`).then(setList, (e) => setError(e.message));
  }, [here]);

  const movingIds = new Set(moving.map((m) => m.id));
  const canDrop = list && list.role !== "viewer";

  return (
    <Modal title={title} onClose={onClose}>
      <div className="form">
        <div className="pickertabs">
          <button className={`chip${here && !here.library && !list?.crumbs[0]?.library ? " on" : ""}`} onClick={() => setHere({})}>
            <HardDrive size={14} /> My files
          </button>
          {libraries.filter((l) => l.role !== "viewer").map((l) => (
            <button key={l.id} className={`chip${list?.crumbs[0]?.library === l.id ? " on" : ""}`} onClick={() => setHere({ library: l.id })}>
              <LibIcon size={14} /> {l.name}
            </button>
          ))}
        </div>
        <nav className="crumbs small" aria-label="Folder path">
          {list?.crumbs.map((c, i) => (
            <span key={i}>
              {i > 0 && <ChevronRight size={12} />}
              <button className="linkbtn" onClick={() => setHere(c.parent ? { parent: c.parent } : c.library ? { library: c.library } : {})}>{c.label}</button>
            </span>
          ))}
        </nav>
        <ul className="pickerlist">
          {!list && <li className="muted">Loading…</li>}
          {list?.items.length === 0 && <li className="muted">No folders here</li>}
          {list?.items.map((f) => (
            <li key={f.id}>
              <button className="pickrow" disabled={movingIds.has(f.id)} onClick={() => setHere({ parent: f.id })}>
                <Folder size={16} color="#e8a317" /> <span className="grow">{f.name}</span> <ChevronRight size={14} />
              </button>
            </li>
          ))}
        </ul>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={!canDrop}
            onClick={async () => {
              const last = list!.crumbs[list!.crumbs.length - 1];
              const target = last.parent ? { parent: last.parent } : last.library ? { library: last.library } : {};
              try {
                await onPick(target);
                onClose();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {action} here
          </button>
        </div>
      </div>
    </Modal>
  );
}
