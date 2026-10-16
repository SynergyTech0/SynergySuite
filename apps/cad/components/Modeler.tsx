"use client";
import { useEffect, useRef, useState } from "react";
import { saveTarget, type Known } from "@/lib/bridge";
import { makeDrawing } from "@/lib/drawing";
import type { AssistantSettings } from "@/lib/ai";
import { MODEL_EXT, OPENS_3D, asModelerMessage, assistantMessage, documentName, drawingName } from "@/lib/model";
import type { Drawing } from "@/lib/store";
import { History } from "./History";
import { needsThumb, uploadDxfThumb, uploadThumb } from "@/lib/thumbnail";
import { ISO, buildModel, projectView } from "@/lib/views";
import type { Part } from "@/lib/views";

/**
 * Chili3D (3D modeling on Open CASCADE) in an iframe, opened with `?host=parent` so it takes
 * models from this page and hands saves and exports back here instead of downloading them.
 * Save (Ctrl+S) writes the model as a .cd document; exports (STEP, STL, ...) add new files.
 * Its AI assistant reaches the suite's model through app/api/ai (lib/ai.ts).
 * "2D drawing" asks the editor for the model's triangles and saves a drawing sheet of it (lib/drawing.ts).
 * A share link opens it `readOnly` with the bytes from `fileUrl`, where saving doesn't write anywhere.
 */
export function Modeler({ file: initial, fileUrl, readOnly = false, folder = "" }: { file: Drawing | null; fileUrl?: string; readOnly?: boolean; folder?: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const current = useRef(initial);
  /** Files this editor opened or saved, so saving again under one of their names replaces it. */
  const known = useRef<Known[]>(initial ? [{ id: initial.id, name: initial.name }] : []);
  const [fileId, setFileId] = useState(initial?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "New model");
  const [status, setStatus] = useState("Loading the 3D editor…");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  /** Geometry requests waiting for the editor's answer, by id. */
  const waiting = useRef(new Map<string, (answer: { document: string; parts: Part[] } | null) => void>());

  const post = (message: object, transfer: Transferable[] = []) => frame.current?.contentWindow?.postMessage(message, location.origin, transfer);

  /** New files (exports, drawings) go in the open file's folder, or the one the library was showing. */
  const where = initial?.folder ?? folder;

  /** Asks the editor for every visible body as triangles. Null when it doesn't answer. */
  async function geometry(): Promise<{ document: string; parts: Part[] } | null> {
    const id = crypto.randomUUID();
    const answer = await new Promise<{ document: string; parts: Part[] } | null>((resolve) => {
      waiting.current.set(id, resolve);
      post({ type: "chili3d:geometry", id });
      setTimeout(() => resolve(null), 30_000);
    });
    waiting.current.delete(id);
    return answer;
  }

  /** The library picture: the model's isometric view. Skipped for very large models. */
  async function makeThumb(fileId: string): Promise<boolean> {
    const answer = await geometry();
    const triangles = answer?.parts.reduce((n, p) => n + p.index.length / 3, 0) ?? 0;
    if (!answer || triangles === 0 || triangles > 300_000) return false;
    return !!(await uploadThumb(fileId, projectView(buildModel(answer.parts), ISO).visible));
  }

  async function makeDrawingFile() {
    setBusy(true);
    setDrawing(null);
    setStatus("Drawing the views…");
    try {
      const answer = await geometry();
      if (!answer) return setStatus("The 3D editor didn't answer. Try again.");
      // Let the status paint before the (synchronous) hidden-line work.
      await new Promise((r) => setTimeout(r, 0));
      const title = answer.document || documentName(name);
      const dxf = makeDrawing(answer.parts, { title, date: new Date().toISOString().slice(0, 10) });
      if (!dxf) return setStatus("There's nothing to draw yet. Add a body to the model first.");
      const fileName = drawingName(title);
      const res = await fetch(`/api/files?name=${encodeURIComponent(fileName)}&folder=${encodeURIComponent(where)}`, { method: "POST", body: dxf });
      if (!res.ok) return setStatus(`Couldn't save ${fileName}.`);
      const { file } = (await res.json()) as { file: Drawing };
      void uploadDxfThumb(file.id, dxf);
      setDrawing(file);
      setStatus(`Saved ${file.name} to your drawings.`);
    } catch (err) {
      setStatus(`Couldn't make the drawing: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {

    async function open(file: Drawing) {
      setStatus(`Opening ${file.name}…`);
      const res = await fetch(fileUrl ?? `/api/files/${file.id}`);
      if (!res.ok) return setStatus(`Couldn't open ${file.name}`);
      const bytes = await res.arrayBuffer();
      post({ type: "chili3d:open", name: file.name, document: documentName(file.name), bytes }, [bytes]);
      setStatus("");
      if (!readOnly && needsThumb(file)) {
        // The editor loads the model after it has the bytes; give it a moment, then once more.
        setTimeout(async () => {
          if (!(await makeThumb(file.id))) setTimeout(() => void makeThumb(file.id), 6000);
        }, 3000);
      }
    }

    async function save(fileName: string, bytes: ArrayBuffer) {
      if (readOnly) return setStatus("This is a view-only link, so changes aren't saved.");
      const target = saveTarget(known.current, fileName);
      setStatus(`Saving ${fileName}…`);
      const res =
        "replace" in target
          ? await fetch(`/api/files/${target.replace}`, { method: "PUT", body: bytes })
          : await fetch(`/api/files?name=${encodeURIComponent(target.create)}&folder=${encodeURIComponent(where)}`, { method: "POST", body: bytes });
      if (!res.ok) return setStatus(`Couldn't save ${fileName}. Your work is still open here.`);
      const { file } = (await res.json()) as { file: Drawing };
      if (OPENS_3D.test(file.name)) void makeThumb(file.id);
      if (!known.current.some((k) => k.id === file.id)) known.current = [{ id: file.id, name: file.name }, ...known.current];
      if (file.name.toLowerCase().endsWith(MODEL_EXT) && !current.current?.name.toLowerCase().endsWith(MODEL_EXT)) {
        // The first save of a new or imported model becomes the file this editor works on.
        current.current = file;
        setFileId(file.id);
        setName(file.name);
        history.replaceState(null, "", `/model/${file.id}`);
      }
      setStatus(`Saved ${file.name} to your drawings`);
    }

    function onMessage(e: MessageEvent) {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return;
      const msg = asModelerMessage(e.data);
      if (!msg) return;
      if (msg.type === "chili3d:ready") {
        setReady(true);
        // The AI assistant uses the suite's model, or stays off when the suite has none. A view-only
        // share link has nothing to edit, so it stays off there.
        void (readOnly ? Promise.reject() : fetch("/api/ai"))
          .then((res) => (res.ok ? (res.json() as Promise<AssistantSettings>) : { enabled: false as const }))
          .catch(() => ({ enabled: false as const }))
          .then((settings) => post(assistantMessage(settings)));
        if (current.current) void open(current.current);
        else {
          post({ type: "chili3d:new", document: "Untitled" });
          setStatus("");
        }
      } else if (msg.type === "chili3d:save") {
        void save(msg.name, msg.bytes);
      } else if (msg.type === "chili3d:geometry") {
        waiting.current.get(msg.id)?.({ document: msg.document, parts: msg.parts });
      } else {
        setStatus(`The 3D editor couldn't start: ${msg.error}`);
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [fileUrl, readOnly]);

  return (
    <main className="editor">
      <div className="bar">
        {!readOnly && <a href={where ? `/?folder=${encodeURIComponent(where)}` : "/"}>Your drawings</a>}
        <span className="file">{name}</span>
        {readOnly && <span className="badge">View only</span>}
        {!readOnly && fileId && <History fileId={fileId} name={name} />}
        {!readOnly && (
        <button type="button" onClick={() => void makeDrawingFile()} disabled={!ready || busy} title="Front, top, right and isometric views with dimensions, as a DXF drawing">
          2D drawing
        </button>
        )}
        <span className="status" role="status">
          {status}
          {drawing && (
            <>
              {" "}
              <a href={`/edit/${drawing.id}`} target="_blank" rel="noopener">
                Open it
              </a>
            </>
          )}
        </span>
      </div>
      <iframe ref={frame} src="/engine3d/index.html?host=parent" title="3D editor" allow="fullscreen; clipboard-read; clipboard-write" />
    </main>
  );
}
