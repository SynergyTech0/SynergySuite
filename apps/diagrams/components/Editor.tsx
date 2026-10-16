"use client";
import { ArrowLeft, Copy, Download, History, Share2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Diagram } from "@/lib/types";
import { ApiError, api, person, shrinkPng } from "./client";
import { ShareDialog } from "./ShareDialog";
import { VersionsDialog } from "./VersionsDialog";

type Status = "loading" | "saved" | "saving" | "unsaved" | "conflict" | "error";
type Msg = { event?: string; xml?: string; data?: string; name?: string; blank?: boolean; message?: Record<string, unknown> };

/**
 * draw.io's editor in embed mode (https://www.drawio.com/doc/faq/embed-mode), served from this
 * app at /drawio/. It talks to this page with JSON messages: it asks for its settings
 * (configure), says it is ready (init), and sends the drawing on every change (autosave) and on
 * Ctrl+S (save). This page loads the diagram into it and saves what it sends.
 *
 * stealth=1 keeps the editor from calling any server but this one (no draw.io, Google or other
 * cloud services); PDF export then goes through the browser's print dialog.
 */
const EDITOR_URL =
  "/drawio/index.html?embed=1&proto=json&spin=1&ui=kennedy&libraries=1&noSaveBtn=1&noExitBtn=1&saveAndExit=0&configure=1&stealth=1&lang=en";

/** Wait this long after the last change before saving, so a drag is one save. */
const SAVE_DELAY = 1200;
/** And this long after the last save before redrawing the list thumbnail. */
const THUMB_DELAY = 5000;

export function Editor({ id, me, editorConfig }: { id: string; me: string; editorConfig: Record<string, unknown> }) {
  const router = useRouter();
  const search = useSearchParams();
  const frame = useRef<HTMLIFrameElement>(null);
  const [diagram, setDiagram] = useState<Diagram | null>(null);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [conflict, setConflict] = useState("");
  const [saveError, setSaveError] = useState("");
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [dialog, setDialog] = useState<"share" | "versions" | null>(null);

  const d = useRef<Diagram | null>(null);
  const version = useRef(0);
  const pending = useRef<string | null>(null);
  const saving = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbWaiter = useRef<(() => void) | null>(null);
  const thumbDirty = useRef(false);
  const startAction = useRef(search.get("templates") === "1" ? "templates" : search.get("ai") === "1" ? "ai" : "");

  const canEdit = diagram ? diagram.role !== "view" : false;

  const post = useCallback((msg: Record<string, unknown>) => {
    frame.current?.contentWindow?.postMessage(JSON.stringify(msg), window.location.origin);
  }, []);

  const fetchDiagram = useCallback(async () => {
    const got = await api<Diagram>(`/api/diagrams/${id}?open=1`);
    d.current = got;
    version.current = got.version;
    setDiagram(got);
    setName(got.name);
    return got;
  }, [id]);

  useEffect(() => {
    fetchDiagram().then(
      () => setStatus("saved"),
      (e) => setLoadError((e as Error).message),
    );
  }, [fetchDiagram]);

  const requestThumbnail = useCallback(() => {
    if (!thumbDirty.current || !d.current || d.current.role === "view") return;
    post({ action: "export", format: "png", border: 12, background: "#ffffff", purpose: "thumbnail" });
  }, [post]);

  const flush = useCallback(
    async (force = false) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      if (saving.current || pending.current === null) return;
      const xml = pending.current;
      pending.current = null;
      saving.current = true;
      setStatus("saving");
      try {
        const r = await api<{ version: number; changed: boolean }>(`/api/diagrams/${id}`, {
          method: "PATCH",
          json: { xml, baseVersion: version.current, ...(force ? { force: true } : {}) },
        });
        version.current = r.version;
        setSaveError("");
        if (r.changed) {
          thumbDirty.current = true;
          if (thumbTimer.current) clearTimeout(thumbTimer.current);
          thumbTimer.current = setTimeout(requestThumbnail, THUMB_DELAY);
        }
        setStatus(pending.current === null ? "saved" : "unsaved");
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          // Keep what this person drew; they decide below.
          pending.current = pending.current ?? xml;
          setConflict(e.message);
          setStatus("conflict");
        } else {
          pending.current = pending.current ?? xml;
          setSaveError((e as Error).message);
          setStatus("error");
        }
      } finally {
        saving.current = false;
      }
      if (pending.current !== null && !conflictRef.current) saveTimer.current = setTimeout(() => void flush(), SAVE_DELAY);
    },
    [id, requestThumbnail],
  );
  const conflictRef = useRef("");
  conflictRef.current = conflict;

  const queue = useCallback(
    (xml: string, now: boolean) => {
      if (!d.current || d.current.role === "view") return;
      pending.current = xml;
      if (thumbTimer.current) clearTimeout(thumbTimer.current);
      if (conflictRef.current) return;
      setStatus((s) => (s === "saving" ? s : "unsaved"));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flush(), now ? 0 : SAVE_DELAY);
    },
    [flush],
  );

  // The editor's messages.
  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow || typeof e.data !== "string") return;
      let m: Msg;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      const cur = d.current;
      if (!cur) return;
      switch (m.event) {
        case "configure":
          post({ action: "configure", config: editorConfig });
          break;
        case "init":
          post({ action: "load", xml: cur.xml, autosave: cur.role === "view" ? 0 : 1, saveAndExit: "0", noSaveBtn: "1", noExitBtn: "1" });
          break;
        case "load": {
          const start = startAction.current;
          startAction.current = "";
          if (start) router.replace(`/d/${id}`);
          if (start === "templates") post({ action: "template", callback: true, noExitOnCancel: true, withoutType: 1 });
          if (start === "ai") post({ action: "invokeAction", actionName: "generate" });
          break;
        }
        case "template":
          // Picked in draw.io's template list: load it and save it as this diagram.
          if (m.xml) {
            post({ action: "load", xml: m.xml, autosave: 1 });
            queue(m.xml, true);
          }
          break;
        case "autosave":
          if (typeof m.xml === "string") queue(m.xml, false);
          break;
        case "save":
          if (typeof m.xml === "string") queue(m.xml, true);
          break;
        case "export":
          if (m.message?.purpose === "thumbnail" && typeof m.data === "string") {
            thumbDirty.current = false;
            try {
              await api(`/api/diagrams/${id}/thumbnail`, { method: "PUT", json: { png: await shrinkPng(m.data) } });
            } catch {
              // A missing picture in the list is not worth interrupting anyone for.
            }
            thumbWaiter.current?.();
          }
          break;
        case "exit":
          router.push("/");
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [editorConfig, id, post, queue, router]);

  // Unsaved changes: say so before the tab closes.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (pending.current !== null || saving.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  /** Saves what's left and redraws the thumbnail before going back to the list. */
  const close = async () => {
    await flush();
    if (thumbDirty.current) {
      if (thumbTimer.current) clearTimeout(thumbTimer.current);
      await new Promise<void>((resolve) => {
        thumbWaiter.current = resolve;
        requestThumbnail();
        setTimeout(resolve, 3000);
      });
    }
    router.push("/");
  };

  const rename = async (value: string) => {
    setRenaming(false);
    const v = value.trim();
    if (!v || !d.current || v === d.current.name) return setName(d.current?.name ?? "");
    try {
      const r = await api<{ name: string }>(`/api/diagrams/${id}`, { method: "PATCH", json: { name: v } });
      d.current = { ...d.current, name: r.name };
      setName(r.name);
      post({ action: "status", message: "", modified: false });
    } catch (e) {
      setSaveError((e as Error).message);
      setName(d.current.name);
    }
  };

  const keepMine = async () => {
    setConflict("");
    conflictRef.current = "";
    await flush(true);
  };

  const loadTheirs = async () => {
    setConflict("");
    conflictRef.current = "";
    pending.current = null;
    const got = await fetchDiagram();
    post({ action: "load", xml: got.xml, autosave: 1 });
    setStatus("saved");
  };

  const makeCopy = async () => {
    const c = await api<{ id: string }>(`/api/diagrams/${id}/copy`, { method: "POST", json: {} });
    window.location.href = `/d/${c.id}`;
  };

  if (loadError) {
    return (
      <div className="pad">
        <h1>Can&apos;t open this diagram</h1>
        <p className="muted">{loadError}</p>
        <a className="btn" href="/">Back to Diagrams</a>
      </div>
    );
  }

  return (
    <div className="editor">
      <header className="editorbar">
        <button className="iconbtn" aria-label="Back to Diagrams" title="Back to Diagrams" onClick={() => void close()}>
          <ArrowLeft size={18} />
        </button>
        {renaming && canEdit ? (
          <input
            className="nameinput"
            aria-label="Diagram name"
            defaultValue={name}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => void rename(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <button className="namebtn" disabled={!canEdit} title={canEdit ? "Rename" : undefined} onClick={() => setRenaming(true)}>
            {name || "Diagram"}
          </button>
        )}
        <span className={`savestate ${status}`} role="status">
          {diagram && !canEdit
            ? `View only · ${person(diagram.owner, me)}'s diagram`
            : status === "saving"
              ? "Saving…"
              : status === "unsaved"
                ? "Unsaved changes"
                : status === "error"
                  ? `Not saved: ${saveError}`
                  : status === "conflict"
                    ? "Not saved"
                    : status === "saved"
                      ? "Saved"
                      : ""}
        </span>
        <span className="grow" />
        {diagram && (
          <>
            {!canEdit && (
              <button className="btn small" onClick={() => void makeCopy()}>
                <Copy size={15} /> Make a copy
              </button>
            )}
            <button className="btn small ghost" onClick={() => setDialog("versions")}>
              <History size={15} /> Versions
            </button>
            <a className="btn small ghost" href={`/api/diagrams/${id}/download`} title="Download as a .drawio file. File › Export as in the editor saves PNG, SVG, PDF or Visio (.vsdx).">
              <Download size={15} /> Download
            </a>
            {diagram.role === "owner" && (
              <button className="btn small primary" onClick={() => setDialog("share")}>
                <Share2 size={15} /> Share
              </button>
            )}
          </>
        )}
      </header>
      {conflict && (
        <div className="banner" role="alert">
          <span className="grow">{conflict}. Your changes since then are only in this window.</span>
          <button className="btn small" onClick={() => void loadTheirs()}>Load the newer copy</button>
          <button className="btn small primary" onClick={() => void keepMine()}>Keep mine</button>
        </div>
      )}
      {diagram ? (
        <iframe
          ref={frame}
          className="drawio"
          title={`Diagram editor: ${name}`}
          src={EDITOR_URL + (canEdit ? "" : "&chrome=0")}
          allow="clipboard-read; clipboard-write"
        />
      ) : (
        <div className="pad muted">Opening…</div>
      )}
      {dialog === "share" && diagram && (
        <ShareDialog diagram={diagram} me={me} onClose={() => setDialog(null)} />
      )}
      {dialog === "versions" && diagram && (
        <VersionsDialog
          id={id}
          me={me}
          canRestore={canEdit}
          onClose={() => setDialog(null)}
          onRestored={async () => {
            pending.current = null;
            const got = await fetchDiagram();
            post({ action: "load", xml: got.xml, autosave: 1 });
            setStatus("saved");
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}
