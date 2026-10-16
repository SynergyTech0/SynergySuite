"use client";

// Audience view: follows a presenter's slide show. The deck comes from the
// shared document (read only); where the presenter is, their ink and their
// subtitles come from collaboration awareness.
import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { animStateAt, buildSteps, prepareSlides, triggerSteps, readSlide, type Masters, type Slide } from "@/lib/slides/model";
import { readMasters } from "@/lib/slides/versions";
import { lookOf, pickPresenter, readDeckMeta, type DeckMeta, type LiveState } from "@/lib/slides/live";
import { DeckSlides, type DeckLook } from "./SlideView";
import { Fitted, InkLayer, type Shown } from "./Slideshow";
import { CaptionBar } from "./captions";

export default function FollowView({ docId, title, user, collabUrl }: { docId: string; title: string; user: { name: string; email: string }; collabUrl: string }) {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [masters, setMasters] = useState<Masters>({});
  const [meta, setMeta] = useState<DeckMeta | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [had, setHad] = useState(false); // someone was presenting
  const [status, setStatus] = useState("connecting");
  const [cc, setCc] = useState(true);
  useEffect(() => {
    // made here, not during render, so a provider is never left connected by a discarded render
    const ydoc = new Y.Doc();
    const url = collabUrl || `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/collab`;
    const provider = new HocuspocusProvider({ url, name: docId, document: ydoc });
    provider.setAwarenessField("user", { name: user.name, email: user.email, color: "#64748b" });
    provider.setAwarenessField("following", true);
    const yslides = ydoc.getArray<Y.Map<string>>("slides"), ymeta = ydoc.getMap<string>("meta"), ylayouts = ydoc.getMap<Y.Map<string>>("layouts");
    const sync = () => setSlides(yslides.toArray().map((m) => readSlide(m)));
    const syncMeta = () => setMeta(readDeckMeta((k) => ymeta.get(k)));
    const syncLayouts = () => setMasters(readMasters(ylayouts.entries()));
    yslides.observeDeep(sync);
    ymeta.observe(syncMeta);
    ylayouts.observeDeep(syncLayouts);
    const onSynced = () => {
      sync();
      syncMeta();
      syncLayouts();
    };
    const onAware = () => {
      const p = pickPresenter(provider.awareness?.getStates().entries() as Iterable<[number, Record<string, unknown>]>, provider.awareness?.clientID);
      setLive(p?.live || null);
      if (p) setHad(true);
    };
    const onStatus = (e: { status: string }) => setStatus(e.status);
    provider.on("synced", onSynced);
    provider.on("status", onStatus);
    provider.awareness?.on("change", onAware);
    if (provider.isSynced) onSynced();
    onAware();
    return () => {
      provider.off("synced", onSynced);
      provider.off("status", onStatus);
      provider.awareness?.off("change", onAware);
      yslides.unobserveDeep(sync);
      ymeta.unobserve(syncMeta);
      ylayouts.unobserveDeep(syncLayouts);
      provider.destroy();
      ydoc.destroy();
    };
  }, [docId, collabUrl, user.name, user.email]);

  const view = useMemo(() => prepareSlides(slides, masters), [slides, masters]);
  const deckCtx = useMemo(() => ({ slides: view }), [view]);
  const look: DeckLook | null = useMemo(() => (meta ? lookOf(meta) : null), [meta]);
  const cur = live ? view.find((s) => s.id === live.sid) : undefined;

  // the slide we came from, while its transition (or zoom) plays
  const [prev, setPrev] = useState<{ slide: Slide; seq: number } | null>(null);
  const last = useRef<{ sid: string; slide?: Slide } | null>(null);
  useEffect(() => {
    if (!live || !cur) return;
    const was = last.current;
    last.current = { sid: live.sid, slide: cur };
    if (!was || was.sid === live.sid || !was.slide) return;
    const t = cur.trans;
    if (!live.zoom && (!t || t.type === "none")) return;
    setPrev({ slide: was.slide, seq: live.seq });
    const h = setTimeout(() => setPrev((p) => (p?.seq === live.seq ? null : p)), (live.zoom ? 700 : t?.dur || 0) + 60);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.sid, live?.seq, cur]);

  const shown: Shown | undefined = useMemo(() => {
    if (!cur || !live) return undefined;
    const anim = animStateAt(buildSteps(cur), live.step, live.fwd, [...triggerSteps(cur)].map(([k, st]) => ({ steps: st, shown: live.trig?.[k] || 0, play: live.tlast === k })));
    return { slide: cur, anim, key: cur.id, trans: cur.trans, ...(prev ? { prev: prev.slide, ...(live.zoom ? { zoom: live.zoom } : {}) } : {}) };
  }, [cur, live, prev]);

  const rootRef = useRef<HTMLDivElement>(null);
  const message = !live
    ? had
      ? "The presenter has stopped sharing."
      : status === "connected"
        ? "Waiting for the presenter to start sharing…"
        : "Connecting…"
    : live.ended
      ? "End of slide show."
      : !cur
        ? "Waiting for the slide…"
        : "";
  return (
    <DeckSlides.Provider value={deckCtx}>
      <div ref={rootRef} data-testid="follow-view" data-sid={live?.sid || ""} data-step={live?.step ?? ""} className="fixed inset-0 bg-black select-none group">
        {look && shown && !message ? (
          <Fitted
            shown={shown}
            look={look}
            blank={live?.blank || null}
            muted
            overlay={
              <>
                <InkLayer strokes={live?.ink || []} look={look} />
                {cc && live?.cap && <CaptionBar text={live.cap} pos="bottom" size="m" />}
              </>
            }
          />
        ) : (
          <div data-testid="follow-message" className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-300">
            <div className="text-lg font-medium text-white">{title}</div>
            <div className="text-sm">{message}</div>
          </div>
        )}
        <div className="absolute top-3 right-3 flex items-center gap-2 text-xs opacity-0 group-hover:opacity-100 transition">
          {live && <span className="text-white/70" data-testid="follow-who">Following {live.name || "the presenter"}</span>}
          <button data-testid="follow-cc" className={`rounded px-2 py-1 ${cc ? "bg-white/40 text-white" : "bg-white/10 text-white/80"} hover:bg-white/30`} title="Subtitles" onClick={() => setCc((v) => !v)}>CC</button>
          <button className="rounded px-2 py-1 bg-white/10 text-white/80 hover:bg-white/30" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : rootRef.current?.requestFullscreen())?.catch(() => {})}>Full screen</button>
        </div>
      </div>
    </DeckSlides.Provider>
  );
}
