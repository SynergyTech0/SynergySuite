"use client";

// File > Export as video: format, size, seconds per slide, and whether to use
// recorded timings and narrations.
import { useEffect, useState } from "react";
import { pickCodecs, type VideoFormat } from "@/lib/slides/video";
import { Modal } from "./DeckDialogs";

export type VideoOptions = { format: VideoFormat; height: 720 | 1080; secs: number; recorded: boolean; transitions: boolean; animations?: boolean };

const CODEC_NAMES: Record<string, string> = { V_VP9: "VP9", V_VP8: "VP8", V_AV1: "AV1", avc: "H.264", av1: "AV1", vp9: "VP9", A_OPUS: "Opus", aac: "AAC", opus: "Opus" };

export function VideoDialog({ aspect, progress, onExport, onCancel, onClose }: { aspect: number; progress: number | null; onExport: (o: VideoOptions) => void; onCancel: () => void; onClose: () => void }) {
  const [o, setO] = useState<VideoOptions>({ format: "webm", height: 720, secs: 5, recorded: true, transitions: true, animations: true });
  const [support, setSupport] = useState<Record<VideoFormat, string | null> | null>(null);
  useEffect(() => {
    let live = true;
    const w = Math.round((720 * aspect) / 2) * 2;
    Promise.all((["webm", "mp4"] as const).map((f) => pickCodecs(f, w, 720))).then(([webm, mp4]) => {
      if (!live) return;
      const name = (c: Awaited<ReturnType<typeof pickCodecs>>) => (c ? `${CODEC_NAMES[c.video.mux] || c.video.mux}${c.audio ? ` + ${CODEC_NAMES[c.audio.mux] || c.audio.mux}` : ", no sound"}` : null);
      const s = { webm: name(webm), mp4: name(mp4) };
      setSupport(s);
      if (!s.webm && s.mp4) setO((x) => ({ ...x, format: "mp4" }));
    });
    return () => {
      live = false;
    };
  }, [aspect]);
  const busy = progress !== null;
  const none = support && !support.webm && !support.mp4;
  return (
    <Modal title="Export as video" testId="video-dialog" onClose={busy ? onCancel : onClose}>
      {none ? (
        <p className="text-slate-600" data-testid="video-unsupported">This browser cannot encode video. Use a current version of Chrome or Edge.</p>
      ) : (
        <>
          <div className="space-y-1">
            {(["webm", "mp4"] as const).map((f) => (
              <label key={f} className={`flex items-center gap-2 ${support && !support[f] ? "opacity-50" : ""}`}>
                <input type="radio" name="vfmt" data-testid={`video-${f}`} disabled={busy || (!!support && !support[f])} checked={o.format === f} onChange={() => setO({ ...o, format: f })} />
                {f === "webm" ? "WebM" : "MP4"}
                <span className="text-xs text-slate-500">{support ? support[f] || "not available in this browser" : "checking…"}</span>
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-slate-700">Size
            <select className="h-8 rounded border border-slate-300 px-1" disabled={busy} value={o.height} onChange={(e) => setO({ ...o, height: Number(e.target.value) as 720 | 1080 })} data-testid="video-size">
              <option value={720}>HD (720p)</option>
              <option value={1080}>Full HD (1080p)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-slate-700">Seconds on each slide
            <input type="number" min={1} max={600} step={0.5} className="w-20 h-8 rounded border border-slate-300 px-2" disabled={busy} value={o.secs} onChange={(e) => setO({ ...o, secs: Math.max(1, Math.min(600, Number(e.target.value) || 5)) })} data-testid="video-secs" />
          </label>
          <label className="flex items-center gap-2 text-slate-700"><input type="checkbox" disabled={busy} checked={o.recorded} onChange={(e) => setO({ ...o, recorded: e.target.checked })} data-testid="video-recorded" />Use recorded timings and narrations</label>
          <label className="flex items-center gap-2 text-slate-700"><input type="checkbox" disabled={busy} checked={o.transitions} onChange={(e) => setO({ ...o, transitions: e.target.checked })} />Play transitions</label>
          <label className="flex items-center gap-2 text-slate-700"><input type="checkbox" data-testid="video-anims" disabled={busy} checked={o.animations !== false} onChange={(e) => setO({ ...o, animations: e.target.checked })} />Play animations</label>
          <p className="text-xs text-slate-500">Slides without a timing stay for the seconds above (or as long as their narration). Animations show their end state; hidden slides are left out.</p>
          {busy && (
            <div className="h-2 rounded bg-slate-100 overflow-hidden" data-testid="video-progress">
              <div className="h-full bg-indigo-600 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
        </>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded px-3 py-1.5 hover:bg-slate-100" onClick={busy ? onCancel : onClose}>Cancel</button>
        {!none && (
          <button type="button" data-testid="video-export" className="rounded bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700 disabled:opacity-40" disabled={busy || !support || !support[o.format]} onClick={() => onExport(o)}>
            {busy ? `Exporting… ${Math.round(progress * 100)}%` : "Export"}
          </button>
        )}
      </div>
    </Modal>
  );
}
