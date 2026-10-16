"use client";
import { Download, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import type { Version } from "@/lib/types";
import { api, download, fullDate, person } from "./client";
import { Modal } from "./Modal";

/** Earlier saves of a diagram: download one, or make it the current version. */
export function VersionsDialog({ id, me, canRestore, onClose, onRestored }: {
  id: string; me: string; canRestore: boolean; onClose: () => void; onRestored: () => Promise<void>;
}) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ versions: Version[] }>(`/api/diagrams/${id}/versions`).then((r) => setVersions(r.versions), (e) => setError((e as Error).message));
  }, [id]);

  return (
    <Modal title="Versions" onClose={onClose} wide>
      <div className="form">
        <p className="small muted">An earlier version is kept every ten minutes while someone is working, and whenever someone else picks up the diagram.</p>
        <p className="error" role="alert">{error}</p>
        {versions && !versions.length && <p className="muted">No earlier versions yet.</p>}
        <ul className="versions">
          {versions?.map((v) => (
            <li key={v.id}>
              <span className="grow">
                {fullDate(v.savedAt)} <span className="muted small">· {person(v.savedBy, me)}{v.name ? ` · ${v.name}` : ""}</span>
              </span>
              <button
                className="btn small ghost"
                onClick={async () => {
                  const r = await api<{ name: string; xml: string }>(`/api/diagrams/${id}/versions/${v.id}`);
                  download(`${r.name} (${new Date(v.savedAt).toISOString().slice(0, 10)}).drawio`, new Blob([r.xml], { type: "application/vnd.jgraph.mxfile" }));
                }}
              >
                <Download size={14} /> Download
              </button>
              {canRestore && (
                <button
                  className="btn small"
                  onClick={async () => {
                    try {
                      await api(`/api/diagrams/${id}/versions/${v.id}`, { method: "POST" });
                      await onRestored();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <RotateCcw size={14} /> Restore
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="actions">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}
