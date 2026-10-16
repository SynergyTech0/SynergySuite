"use client";
import { ChevronLeft, ChevronRight, Download, ExternalLink, Share2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { FileIcon } from "./FileIcon";
import { formatSize, previewKind } from "./client";

type Previewable = { id: string; name: string; mime: string; size: number; kind: "file" | "folder" };

const TEXT_LIMIT = 2 * 1024 * 1024;

/** Full-window viewer for one file, with arrows to the next and previous files in the list. */
export function Preview({
  item, src, download, onClose, onPrev, onNext, onShare, openWith,
}: {
  item: Previewable; src: string; download: string;
  onClose: () => void; onPrev?: () => void; onNext?: () => void; onShare?: () => void;
  /** Another suite app that opens this kind of file, e.g. Whiteboard for .excalidraw. */
  openWith?: { label: string; href: string };
}) {
  const kind = previewKind(item.mime);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && onPrev) onPrev();
      else if (e.key === "ArrowRight" && onNext) onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={item.name}>
      <div className="viewerhead">
        <FileIcon kind="file" name={item.name} />
        <span className="grow viewername">{item.name}</span>
        {openWith && (
          <a className="btn ghost dark" href={openWith.href} target="_blank" rel="noreferrer">
            <ExternalLink size={16} /> {openWith.label}
          </a>
        )}
        {onShare && (
          <button className="btn ghost dark" onClick={onShare}>
            <Share2 size={16} /> Share
          </button>
        )}
        <a className="btn ghost dark" href={download}>
          <Download size={16} /> Download
        </a>
        <button className="iconbtn dark" aria-label="Close" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <div className="viewerbody">
        {onPrev && (
          <button className="viewnav left" aria-label="Previous file" onClick={onPrev}>
            <ChevronLeft size={28} />
          </button>
        )}
        <Body key={src} kind={kind} item={item} src={src} download={download} />
        {onNext && (
          <button className="viewnav right" aria-label="Next file" onClick={onNext}>
            <ChevronRight size={28} />
          </button>
        )}
      </div>
    </div>
  );
}

function Body({ kind, item, src, download }: { kind: ReturnType<typeof previewKind>; item: Previewable; src: string; download: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (kind !== "text") return;
    if (item.size > TEXT_LIMIT) return setText(null);
    fetch(src).then((r) => r.text()).then(setText, () => setText(""));
  }, [kind, src, item.size]);

  if (kind === "image") return <img className="viewimg" src={src} alt={item.name} />;
  if (kind === "pdf") return <iframe className="viewpdf" src={src} title={item.name} />;
  if (kind === "video") return <video className="viewmedia" src={src} controls autoPlay />;
  if (kind === "audio") return <audio src={src} controls autoPlay />;
  if (kind === "text" && item.size <= TEXT_LIMIT) return <pre className="viewtext">{text ?? "Loading…"}</pre>;
  return (
    <div className="noview">
      <FileIcon kind="file" name={item.name} size={64} />
      <p>{item.name}</p>
      <p className="muted">{formatSize(item.size)} · No preview for this kind of file</p>
      <a className="btn primary" href={download}>
        <Download size={16} /> Download
      </a>
    </div>
  );
}
