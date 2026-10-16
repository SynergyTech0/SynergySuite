"use client";
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  convertToExcalidrawElements,
  exportToBlob,
  exportToSvg,
  reconcileElements,
  restoreElements,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { AppState, BinaryFileData, BinaryFiles, Collaborator, ExcalidrawImperativeAPI, SocketId } from "@excalidraw/excalidraw/types";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { useEffect, useRef } from "react";
import * as Y from "yjs";
import type { Board } from "@/lib/boards";
import { ELEMENTS, FILES, MAX_FILE_CHARS } from "@/lib/scene.mjs";
import { type Peer, type Presence, centreOn, changedSince, freeSpot, peersFrom, viewportCenter } from "@/lib/sync";
import { type Skeleton, STICKY_SIZE, sticky, stickyGrid, templateById } from "@/lib/templates";
import { api, colorFor } from "./client";

export type Status = "connecting" | "live" | "offline" | "denied";

/** What the board's header can ask the canvas to do. */
export type CanvasActions = {
  addSticky: (color: string) => void;
  addIdeas: (ideas: string[]) => void;
  /** The board as a file: .excalidraw (JSON), .png or .svg. */
  exportAs: (format: "excalidraw" | "png" | "svg") => Promise<Blob>;
  /** The words written on the board, for AI ideas. */
  words: () => string;
};

let fonts: Promise<unknown> | null = null;
function fontsReady(): Promise<unknown> {
  fonts ??= Promise.race([
    document.fonts.load("20px Excalifont").catch(() => null),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
  return fonts;
}

// Excalidraw loads its fonts from here (copied into public/fonts at build) instead of a CDN.
if (typeof window !== "undefined") (window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = "/";

const LOCAL = Symbol("local");
const SEND_MS = 50;
const POINTER_MS = 40;
const THUMB_MS = 20_000;

/**
 * The live canvas. Each person's Excalidraw scene is kept in step with the board's Yjs document:
 * local changes go out as changed elements (by version), other people's come in and are merged
 * with Excalidraw's own reconciler, and cursors and selections travel through awareness.
 */
export default function BoardCanvas({
  board, me, collabUrl, readOnly, onStatus, onPeers, onReady, onToast,
}: {
  board: Board;
  me: { email: string; name: string };
  collabUrl: string;
  readOnly: boolean;
  onStatus: (s: Status) => void;
  onPeers: (p: Peer[]) => void;
  onReady: (a: CanvasActions) => void;
  onToast: (msg: string) => void;
}) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const yRef = useRef<{ doc: Y.Doc; provider: HocuspocusProvider; els: Y.Map<string>; files: Y.Map<string> } | null>(null);
  const known = useRef(new Map<string, number>());
  const sentFiles = useRef(new Set<string>());
  const pending = useRef<{ elements: readonly OrderedExcalidrawElement[]; files: BinaryFiles } | null>(null);
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const incoming = useRef<RemoteExcalidrawElement[]>([]);
  const applyTimer = useRef<number | null>(null);
  const synced = useRef(false);
  const lastPointer = useRef(0);
  const lastSelected = useRef("");
  const dirtySince = useRef(0);
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const cbs = useRef({ onStatus, onPeers, onToast });
  cbs.current = { onStatus, onPeers, onToast };

  // ---- the shared document ----
  useEffect(() => {
    const doc = new Y.Doc();
    const els = doc.getMap<string>(ELEMENTS);
    const files = doc.getMap<string>(FILES);
    let denied = false;
    const provider = new HocuspocusProvider({
      url: collabUrl,
      name: board.id,
      document: doc,
      onStatus: ({ status }) => {
        if (!denied) cbs.current.onStatus(status === "connected" ? (synced.current ? "live" : "connecting") : status === "connecting" ? "connecting" : "offline");
      },
      onSynced: () => {
        synced.current = true;
        cbs.current.onStatus("live");
        loadAll();
      },
      onClose: ({ event }) => {
        // The server refuses a connection when the person has lost access to the board.
        if (event.code === 4403 || event.code === 4401 || /forbidden|unauthenticated/i.test(event.reason)) {
          denied = true;
          cbs.current.onStatus("denied");
          provider.disconnect();
        }
      },
    });
    yRef.current = { doc, provider, els, files };

    provider.awareness?.setLocalStateField("user", { name: me.name, email: me.email, color: colorFor(me.email) });

    // Someone else's changes: queue them and merge once per frame.
    els.observe((ev, tr) => {
      if (tr.origin === LOCAL || !synced.current) return;
      for (const key of ev.keysChanged) {
        const json = els.get(key);
        if (!json) continue;
        try {
          const el = JSON.parse(json) as RemoteExcalidrawElement;
          known.current.set(el.id, el.version);
          incoming.current.push(el);
        } catch {
          /* skip a bad entry */
        }
      }
      if (applyTimer.current === null) applyTimer.current = requestAnimationFrame(applyIncoming);
    });
    files.observe((ev, tr) => {
      if (tr.origin === LOCAL || !synced.current) return;
      const add: BinaryFileData[] = [];
      for (const key of ev.keysChanged) {
        const json = files.get(key);
        if (!json) continue;
        try {
          add.push(JSON.parse(json));
          sentFiles.current.add(key);
        } catch {
          /* skip a bad entry */
        }
      }
      if (add.length) apiRef.current?.addFiles(add);
    });

    const onAwareness = () => {
      const peers = peersFrom(provider.awareness!.getStates() as Map<number, Presence>, provider.awareness!.clientID);
      cbs.current.onPeers(peers);
      const collaborators = new Map<SocketId, Collaborator>(
        peers.map((p) => [p.id as SocketId, { id: p.id, username: p.username, color: p.color, pointer: p.pointer, button: p.button, selectedElementIds: p.selectedElementIds }]),
      );
      apiRef.current?.updateScene({ collaborators });
    };
    provider.awareness?.on("change", onAwareness);

    const flushOnLeave = () => flush();
    window.addEventListener("beforeunload", flushOnLeave);

    return () => {
      window.removeEventListener("beforeunload", flushOnLeave);
      flush();
      provider.awareness?.off("change", onAwareness);
      provider.destroy();
      doc.destroy();
      yRef.current = null;
      synced.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.id, collabUrl]);

  /** First load: the whole board from the shared document, then the template if it's new. */
  function loadAll() {
    const y = yRef.current;
    const ex = apiRef.current;
    if (!y || !ex) return; // the canvas calls this again once it is ready
    const parsed: ExcalidrawElement[] = [];
    for (const json of y.els.values()) {
      try {
        parsed.push(JSON.parse(json));
      } catch {
        /* skip a bad entry */
      }
    }
    const remote = restoreElements(parsed, null) as RemoteExcalidrawElement[];
    for (const el of remote) known.current.set(el.id, el.version);
    const elements = reconcileElements(ex.getSceneElementsIncludingDeleted(), remote, ex.getAppState());
    const files: BinaryFileData[] = [];
    for (const [id, json] of y.files.entries()) {
      try {
        files.push(JSON.parse(json));
        sentFiles.current.add(id);
      } catch {
        /* skip a bad entry */
      }
    }
    if (files.length) ex.addFiles(files);
    ex.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
    if (elements.some((e) => !e.isDeleted)) ex.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9 });
    void layOutTemplate(y.els.size === 0);
  }

  async function layOutTemplate(empty: boolean) {
    if (!empty || readOnlyRef.current || !board.pendingTemplate) return;
    try {
      const { template } = await api<{ template: string | null }>(`/api/boards/${board.id}/template`, { method: "POST" });
      const t = template ? templateById(template) : undefined;
      if (!t) return;
      await insert(t.build(), { select: false });
      apiRef.current?.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.85 });
    } catch {
      /* the board just stays blank */
    }
  }

  function applyIncoming() {
    applyTimer.current = null;
    const ex = apiRef.current;
    if (!ex || !incoming.current.length) return;
    const batch = restoreElements(incoming.current, null) as RemoteExcalidrawElement[];
    incoming.current = [];
    const elements = reconcileElements(ex.getSceneElementsIncludingDeleted(), batch, ex.getAppState());
    ex.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
  }

  /** Writes changed elements and new images to the shared document. */
  function flush() {
    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = null;
    const y = yRef.current;
    const p = pending.current;
    pending.current = null;
    if (!y || !p || !synced.current || readOnlyRef.current) return;
    const changed = changedSince(p.elements, known.current);
    const newFiles = Object.values(p.files).filter((f) => !sentFiles.current.has(f.id));
    if (!changed.length && !newFiles.length) return;
    y.doc.transact(() => {
      for (const el of changed) {
        y.els.set(el.id, JSON.stringify(el));
        known.current.set(el.id, el.version);
      }
      for (const f of newFiles) {
        sentFiles.current.add(f.id);
        const json = JSON.stringify({ id: f.id, mimeType: f.mimeType, dataURL: f.dataURL, created: f.created });
        if (json.length > MAX_FILE_CHARS) {
          cbs.current.onToast("That image is too large to share on the board (4 MB at most).");
          continue;
        }
        y.files.set(f.id, json);
      }
    }, LOCAL);
    dirtySince.current ||= Date.now();
  }

  function onChange(elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) {
    const y = yRef.current;
    if (y && synced.current) {
      const sel = Object.keys(appState.selectedElementIds).sort().join(",");
      if (sel !== lastSelected.current) {
        lastSelected.current = sel;
        y.provider.awareness?.setLocalStateField("selected", appState.selectedElementIds);
      }
    }
    if (readOnlyRef.current) return;
    pending.current = { elements, files };
    if (!sendTimer.current) sendTimer.current = setTimeout(flush, SEND_MS);
  }

  // ---- a small picture of the board for the board list ----
  useEffect(() => {
    if (readOnly) return;
    const timer = setInterval(async () => {
      const ex = apiRef.current;
      if (!ex || !dirtySince.current) return;
      dirtySince.current = 0;
      const elements = ex.getSceneElements();
      if (!elements.length) return;
      try {
        const blob = await exportToBlob({
          elements, files: ex.getFiles(), mimeType: "image/png", maxWidthOrHeight: 480,
          appState: { ...ex.getAppState(), exportBackground: true, viewBackgroundColor: "#ffffff" },
        });
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
        await api(`/api/boards/${board.id}/thumbnail`, { method: "PUT", json: { dataUrl } });
      } catch {
        /* the list keeps the older picture */
      }
    }, THUMB_MS);
    return () => clearInterval(timer);
  }, [board.id, readOnly]);

  /** Adds skeleton shapes centred where the person is looking, as one undoable step. */
  async function insert(items: Skeleton[], opts: { select?: boolean; at?: "centre" | "as-is" } = {}) {
    // Text is measured as it is made, so the hand-drawn font must be loaded first.
    await fontsReady();
    const ex = apiRef.current;
    if (!ex || readOnlyRef.current) return;
    const c = viewportCenter(ex.getAppState());
    const placed = opts.at === "as-is" ? items : centreOn(items, c.x, c.y);
    const made = convertToExcalidrawElements(placed as Parameters<typeof convertToExcalidrawElements>[0], { regenerateIds: false });
    ex.updateScene({
      elements: [...ex.getSceneElementsIncludingDeleted(), ...made],
      ...(opts.select !== false ? { appState: { selectedElementIds: Object.fromEntries(made.filter((e) => !("containerId" in e && e.containerId)).map((e) => [e.id, true as const])) } } : {}),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    // Back to the canvas, so Enter starts writing on a new sticky note.
    document.querySelector<HTMLElement>(".canvas .excalidraw")?.focus();
  }

  function ready(ex: ExcalidrawImperativeAPI) {
    apiRef.current = ex;
    if (synced.current) loadAll();
    onReady({
      addSticky: (color) => {
        const c = viewportCenter(ex.getAppState());
        const notes = ex.getSceneElements().filter((e) => e.customData?.sticky);
        const at = freeSpot(c.x - STICKY_SIZE / 2, c.y - STICKY_SIZE / 2, notes);
        void insert([sticky(at.x, at.y, color)], { at: "as-is" });
        cbs.current.onToast("Press Enter or double-click the note to write on it.");
      },
      addIdeas: (ideas) => void insert(stickyGrid(ideas, 0, 0, { perRow: Math.min(4, Math.ceil(Math.sqrt(ideas.length))), color: ["yellow", "pink", "green", "blue"] })),
      exportAs: async (format) => {
        const elements = ex.getSceneElements();
        const appState = ex.getAppState();
        const files = ex.getFiles();
        if (format === "excalidraw") return new Blob([serializeAsJSON(elements, appState, files, "local")], { type: "application/json" });
        if (format === "svg") {
          const svg = await exportToSvg({ elements, files, appState: { ...appState, exportBackground: true, exportEmbedScene: true } });
          return new Blob([svg.outerHTML], { type: "image/svg+xml" });
        }
        return exportToBlob({ elements, files, mimeType: "image/png", appState: { ...appState, exportBackground: true, exportScale: 2 } });
      },
      words: () =>
        ex.getSceneElements()
          .filter((e) => e.type === "text")
          .map((e) => ("text" in e ? String(e.text) : ""))
          .join("\n")
          .slice(0, 6000),
    });
  }

  return (
    <Excalidraw
      excalidrawAPI={ready}
      isCollaborating
      viewModeEnabled={readOnly}
      name={board.title}
      onChange={onChange}
      onPointerUpdate={({ pointer, button }) => {
        const now = Date.now();
        if (now - lastPointer.current < POINTER_MS) return;
        lastPointer.current = now;
        const aw = yRef.current?.provider.awareness;
        aw?.setLocalStateField("pointer", pointer);
        aw?.setLocalStateField("button", button);
      }}
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }}
      initialData={{ appState: { currentItemFontFamily: 5, viewBackgroundColor: "#ffffff" }, scrollToContent: true }}
    >
      <MainMenu>
        <MainMenu.DefaultItems.Export />
        <MainMenu.DefaultItems.SaveAsImage />
        <MainMenu.DefaultItems.SearchMenu />
        <MainMenu.DefaultItems.Help />
        {!readOnly && <MainMenu.DefaultItems.ClearCanvas />}
        <MainMenu.Separator />
        <MainMenu.DefaultItems.ToggleTheme />
        <MainMenu.DefaultItems.ChangeCanvasBackground />
      </MainMenu>
    </Excalidraw>
  );
}
