"use client";
import { useEffect, useRef, useState } from "react";
import { asEngineMessage, saveTarget } from "@/lib/bridge";
import type { PhotoFile } from "@/lib/store";

/**
 * The PhotoCraft engine in an iframe, opened with `?host` so it takes files from this page and
 * hands saves back here instead of downloading them. Saves land in the user's library.
 */
export function Editor({ file: initial }: { file: PhotoFile | null }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const current = useRef(initial);
  /** Files this editor opened or saved, so saving again under one of their names replaces it. */
  const known = useRef<PhotoFile[]>(initial ? [initial] : []);
  const [name, setName] = useState(initial?.name ?? "New image");
  const [status, setStatus] = useState("Loading the editor…");

  useEffect(() => {
    async function onMessage(e: MessageEvent) {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return;
      const msg = asEngineMessage(e.data);
      if (!msg) return;
      if (msg.type === "photocraft:ready") {
        const file = current.current;
        if (!file) return setStatus("");
        setStatus(`Opening ${file.name}…`);
        const res = await fetch(`/api/files/${file.id}`);
        if (!res.ok) return setStatus(`Couldn't open ${file.name}`);
        const bytes = await res.arrayBuffer();
        frame.current?.contentWindow?.postMessage({ type: "photocraft:open", name: file.name, bytes }, location.origin, [bytes]);
        setStatus("");
        return;
      }
      const target = saveTarget(known.current, msg.name);
      setStatus(`Saving ${msg.name}…`);
      const res =
        "replace" in target
          ? await fetch(`/api/files/${target.replace}`, { method: "PUT", body: msg.bytes })
          : await fetch(`/api/files?name=${encodeURIComponent(target.create)}`, { method: "POST", body: msg.bytes });
      if (!res.ok) return setStatus(`Couldn't save ${msg.name}. Your work is still open here.`);
      const { file } = (await res.json()) as { file: PhotoFile };
      known.current = [file, ...known.current.filter((f) => f.id !== file.id)];
      if (!current.current) {
        // A new image's first save becomes the file this editor works on.
        current.current = file;
        setName(file.name);
        history.replaceState(null, "", `/edit/${file.id}`);
      }
      setStatus(`Saved ${file.name} to your images`);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <main className="editor">
      <div className="bar">
        <a href="/">Your images</a>
        <span className="file">{name}</span>
        <span className="status" role="status">{status}</span>
      </div>
      <iframe
        ref={frame}
        src="/engine/index.html?host"
        title="Photo editor"
        allow="fullscreen; clipboard-read; clipboard-write"
      />
    </main>
  );
}
