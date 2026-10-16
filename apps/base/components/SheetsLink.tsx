"use client";
/**
 * "Link to Sheets": a data link (lib/dataLinks.ts) for a table or saved query, to paste into
 * Sheets' Data > Get data > From web. Sheets keeps the address, so Refresh pulls the current data.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DataLink, LinkSource } from "@/lib/dataLinks";

export function SheetsLink({ databaseId, source, name, canEdit }: { databaseId: string; source: LinkSource; name: string; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} title="Get an address Sheets can read this from">
        Link to Sheets
      </button>
      {open && <SheetsLinkDialog databaseId={databaseId} source={source} name={name} canEdit={canEdit} onClose={() => setOpen(false)} />}
    </>
  );
}

function SheetsLinkDialog({ databaseId, source, name, canEdit, onClose }: { databaseId: string; source: LinkSource; name: string; canEdit: boolean; onClose: () => void }) {
  const [link, setLink] = useState<DataLink | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const base = `/api/databases/${databaseId}/links`;
  const url = link ? `${location.origin}${link.path}` : "";

  useEffect(() => {
    api<{ link: DataLink | null }>(`${base}?kind=${source.kind}&source=${source.id}`)
      .then((d) => setLink(d.link))
      .catch((e) => setError(e.message));
  }, [base, source.kind, source.id]);

  async function change(method: "POST" | "DELETE") {
    if (method === "DELETE" && !confirm("Turn this link off? Sheets that use it stop refreshing.")) return;
    try {
      setLink((await api<{ link: DataLink | null }>(base, { method, body: source })).link);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Copy the address by hand; the browser blocked the clipboard.");
    }
  }

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal sheets-link" role="dialog" aria-label="Link to Sheets" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Link {name} to Sheets</h3>
        {link === undefined && !error && <p className="muted">Loading…</p>}
        {link === null && (
          <>
            <p>A data link is a private address that reads this {source.kind} as CSV. Sheets uses it to bring the records into a workbook, and refreshing brings in later changes.</p>
            <p className="muted small">Anyone who has the address can read the data without signing in, so share it as you would a password. You can turn it off at any time.</p>
            {canEdit ? (
              <div className="actions">
                <button className="primary" onClick={() => change("POST")}>
                  Make a link
                </button>
                <button onClick={onClose}>Cancel</button>
              </div>
            ) : (
              <p className="muted">Ask an editor of this database to make one.</p>
            )}
          </>
        )}
        {link && (
          <>
            <div className="link-row">
              <input readOnly aria-label="Data link" value={url} onFocus={(e) => e.target.select()} />
              <button className="primary" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <ol className="small">
              <li>In Sheets, open Data, choose Get data…, then From web.</li>
              <li>Paste the address and keep "First row has headers" ticked.</li>
              <li>Choose Data, then Refresh all queries, whenever you want the latest records.</li>
            </ol>
            <p className="muted small">
              Made by {link.createdBy}. It reads what they can see, and stops working if they lose access to this database.
            </p>
            <div className="actions">
              {canEdit && (
                <button className="danger" onClick={() => change("DELETE")}>
                  Turn off link
                </button>
              )}
              <button onClick={onClose}>Done</button>
            </div>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
