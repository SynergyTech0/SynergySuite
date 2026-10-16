"use client";
import { useEffect, useRef, useState } from "react";
import { asEngineMessage, engineName, isDwg, saveTarget, saveVersion, type Known } from "@/lib/bridge";
import { dwgConverter, type Converter } from "@/lib/dwg";
import type { Drawing } from "@/lib/store";
import { History } from "./History";
import { needsThumb, uploadDxfThumb } from "@/lib/thumbnail";

/**
 * CADCraft in an iframe, opened with `?host=parent` so it takes drawings from this page and hands
 * saves back here instead of downloading them. Saves land in the user's drawings. DWG files go
 * through lib/dwg.ts on the way in and out, since the engine's web build reads and writes DXF.
 *
 * A share link opens it `readOnly` with the bytes from `fileUrl`: the drawing can be looked at,
 * zoomed and measured, but saving doesn't write anywhere.
 */
export function Editor({ file: initial, fileUrl, readOnly = false, folder = "" }: { file: Drawing | null; fileUrl?: string; readOnly?: boolean; folder?: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const current = useRef(initial);
  /** Files this editor opened or saved, so saving again under one of their names replaces it. */
  const known = useRef<Known[]>(initial ? [{ id: initial.id, name: initial.name, dwg: isDwg(initial.name) ? "" : undefined }] : []);
  const converter = useRef<Converter | null>(null);
  const dirty = useRef(false);
  const [fileId, setFileId] = useState(initial?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "New drawing");
  const [status, setStatus] = useState("Loading the editor…");
  /** New files (Save As, exports) go in the open file's folder, or the one the library was showing. */
  const where = initial?.folder ?? folder;

  useEffect(() => {
    const dwg = () => (converter.current ??= dwgConverter());
    const post = (message: object, transfer: Transferable[] = []) => frame.current?.contentWindow?.postMessage(message, location.origin, transfer);

    async function open(file: Drawing) {
      setStatus(`Opening ${file.name}…`);
      const res = await fetch(fileUrl ?? `/api/files/${file.id}`);
      if (!res.ok) return setStatus(`Couldn't open ${file.name}`);
      let bytes = await res.arrayBuffer();
      if (isDwg(file.name)) {
        setStatus(`Converting ${file.name}…`);
        try {
          const { dxf, version } = await dwg().toDxf(bytes);
          bytes = dxf;
          known.current = known.current.map((k) => (k.id === file.id ? { ...k, dwg: version ?? "" } : k));
        } catch (e) {
          return setStatus(`Couldn't open ${file.name}: ${e instanceof Error ? e.message : e}`);
        }
      }
      // Read the text for the library picture before the bytes are handed to the editor.
      const text = !readOnly && needsThumb(file) ? new TextDecoder("latin1").decode(bytes) : null;
      post({ type: "cadcraft:open", name: engineName(file.name), bytes }, [bytes]);
      setStatus("");
      if (text) setTimeout(() => void uploadDxfThumb(file.id, text), 1000);
    }

    async function save(engineFile: string, bytes: ArrayBuffer) {
      if (readOnly) return setStatus("This is a view-only link, so changes aren't saved.");
      const target = saveTarget(known.current, engineFile);
      const shown = "replace" in target ? (known.current.find((k) => k.id === target.replace)?.name ?? engineFile) : target.create;
      setStatus(`Saving ${shown}…`);
      let body = bytes;
      if ("replace" in target && target.dwg !== undefined) {
        try {
          body = await dwg().toDwg(bytes, saveVersion(target.dwg));
        } catch (e) {
          return setStatus(`Couldn't save ${shown} as DWG: ${e instanceof Error ? e.message : e}. Your work is still open here; Save As DXF keeps it.`);
        }
      }
      const res =
        "replace" in target
          ? await fetch(`/api/files/${target.replace}`, { method: "PUT", body })
          : await fetch(`/api/files?name=${encodeURIComponent(target.create)}&folder=${encodeURIComponent(where)}`, { method: "POST", body });
      if (!res.ok) return setStatus(`Couldn't save ${shown}. Your work is still open here.`);
      const { file } = (await res.json()) as { file: Drawing };
      if (/\.(dxf|dwg)$/i.test(file.name)) void uploadDxfThumb(file.id, new TextDecoder("latin1").decode(bytes));
      if (!known.current.some((k) => k.id === file.id)) known.current = [{ id: file.id, name: file.name }, ...known.current];
      if (!current.current) {
        // A new drawing's first save becomes the file this editor works on.
        current.current = file;
        setFileId(file.id);
        setName(file.name);
        history.replaceState(null, "", `/edit/${file.id}`);
      }
      setStatus(`Saved ${file.name} to your drawings`);
    }

    function onMessage(e: MessageEvent) {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return;
      const msg = asEngineMessage(e.data);
      if (!msg) return;
      if (msg.type === "cadcraft:ready") {
        if (current.current) void open(current.current);
        else setStatus("");
      } else if (msg.type === "cadcraft:save") {
        void save(msg.name, msg.bytes);
      } else if (msg.type === "cadcraft:dirty") {
        dirty.current = msg.dirty && !readOnly;
      } else {
        setStatus(`The editor couldn't start: ${msg.error}`);
      }
    }

    function onLeave(e: BeforeUnloadEvent) {
      if (dirty.current) e.preventDefault();
    }

    window.addEventListener("message", onMessage);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [fileUrl, readOnly, where]);

  return (
    <main className="editor">
      <div className="bar">
        {!readOnly && <a href={where ? `/?folder=${encodeURIComponent(where)}` : "/"}>Your drawings</a>}
        <span className="file">{name}</span>
        {readOnly && <span className="badge">View only</span>}
        {!readOnly && fileId && (
          <History
            fileId={fileId}
            name={name}
            onRestored={() => {
              dirty.current = false; // the restore confirm already warned about unsaved changes
              location.reload();
            }}
          />
        )}
        <span className="status" role="status">{status}</span>
      </div>
      <iframe
        ref={frame}
        src="/engine/index.html?host=parent"
        title="CAD editor"
        allow="fullscreen; clipboard-read; clipboard-write"
      />
    </main>
  );
}
