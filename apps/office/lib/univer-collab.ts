// Real-time collaboration for Univer spreadsheets.
//
// Univer is a command-based engine, not a CRDT: every change runs through the
// command service, which emits low-level *mutations* (`sheet.mutation.*`) that
// are pure, serializable, and deterministically replayable. Univer's own paid
// collaboration works by shipping those mutations between peers; we do the same
// over the collab server we already run (Hocuspocus/Yjs), so no new infra.
//
// Transport & durability: a Yjs doc per sheet (document name = docId, persisted
// to Postgres by Hocuspocus exactly like docs/slides). It holds:
//   • meta.base  — a full workbook snapshot (JSON), the agreed starting point
//   • ops        — a Y.Array of mutations after the base, in Yjs's canonical
//                  total order (every client converges on the same order)
// Current state = base + apply(ops in order). Because every client applies the
// same ops from the same base, everyone converges — that's the collaboration.
//
// What we DON'T broadcast (each client derives these itself, so sending them
// would loop or fight the local engine):
//   • formula results — written as set-range-values but flagged onlyLocal /
//     applyFormulaCalculationResult; the receiver's formula engine recomputes
//     from the cell's `f` (which does travel, inside set-range-values)
//   • fromCollab mutations — ones we just applied from a peer
//   • selections/cursors — operations, per-user, not document state
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { createWorkbookFromSnapshot } from "./univer-workbook";

type Cmd = { id: string; type?: number; params?: unknown };
type Options =
  | {
      fromCollab?: boolean;
      onlyLocal?: boolean;
      applyFormulaCalculationResult?: boolean;
    }
  | undefined;

// Document mutations from the feature plugins live outside the "sheet.mutation."
// namespace: data validation, hyperlinks, defined names.
const SHARED_MUTATION_PREFIXES = ["sheet.mutation.", "sheets.mutation.", "data-validation.mutation."];
const SHARED_MUTATIONS = new Set(["formula.mutation.set-defined-name", "formula.mutation.remove-defined-name"]);
// Per-client UI state or engine bookkeeping that happens to use a sheet prefix.
const LOCAL_MUTATIONS = new Set(["sheet.mutation.toggle-note-popup", "sheet.mutation.data-validation-formula-mark-dirty"]);

// A mutation is shared document state worth broadcasting only if it is a sheet
// document mutation that the local user (not a peer, not the formula engine,
// not a transient local-only path) just produced.
function isBroadcastable(command: Cmd, options: Options): boolean {
  const id = command?.id;
  if (!id || LOCAL_MUTATIONS.has(id)) return false;
  if (!SHARED_MUTATIONS.has(id) && !SHARED_MUTATION_PREFIXES.some((p) => id.startsWith(p))) return false;
  if (options?.fromCollab) return false; // already applied from a peer
  if (options?.onlyLocal) return false; // formula calc / transient, per-client
  if (options?.applyFormulaCalculationResult) return false; // computed value
  if ((options as Record<string, unknown> | undefined)?.synergyTransient) return false; // working values (data tables), per-client
  return true;
}

const COMPACT_THRESHOLD = 400; // fold ops into a fresh base past this many…
// …but only when alone (peers === 1): with no concurrent editors the live
// workbook exactly equals base+ops, so snapshot→base and clearing ops is
// race-free. Multi-user sessions simply defer compaction until someone is last.

// Stable per-user color (hex, so both CSS and Univer's ColorKit accept it).
const PALETTE = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
function colorFor(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// A Univer mark-selection style tinted to a collaborator's color: a colored
// border + faint fill, no autofill/resize handles (those are for the local
// editing selection, not a presence marker).
function markStyle(color: string) {
  return {
    strokeWidth: 2,
    stroke: color,
    fill: color + "22",
    widgets: {},
    widgetSize: 0,
    widgetStrokeWidth: 0,
    widgetStroke: color,
    autofillSize: 0,
    autofillStrokeWidth: 0,
    autofillStroke: color,
    rowHeaderFill: color + "33",
    rowHeaderStroke: color,
    rowHeaderStrokeWidth: 1,
    columnHeaderFill: color + "33",
    columnHeaderStroke: color,
    columnHeaderStrokeWidth: 1,
    expandCornerSize: 0,
  };
}

export type Participant = { name: string; email: string; color: string; self?: boolean };

// Live-presence layer (remote cursors + roster). Data co-editing does not depend
// on it; this switch turns the whole layer off if it ever misbehaves.
const PRESENCE_ENABLED = true;

// Structural, permissive view of Univer's FUniver facade. `any` params keep it
// assignable from the fully-typed FUniver without importing its heavy types.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type FUniverLike = {
  createWorkbook: (snapshot: any, options?: any) => any;
  onCommandExecuted: (cb: (command: any, options: any) => void) => { dispose: () => void } | undefined;
  syncExecuteCommand: (id: string, params: any, options?: any) => any;
  getActiveWorkbook?: () => any;
  getInjector?: () => { get: (id: any) => any };
  disposeUnit?: (unitId: string) => boolean;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export type SheetCollabHandle = {
  provider: HocuspocusProvider;
  ydoc: Y.Doc;
  /** Replace the whole shared workbook (e.g. an opened .xlsx) for everyone. */
  replaceWorkbook: (snapshot: unknown) => void;
  /** Tell everyone else in the sheet that comments changed (they refetch). */
  notifyComments: () => void;
  destroy: () => void;
};

/**
 * Wire a Univer workbook into real-time collaboration. Call once, after
 * createUniver() but *before* creating any workbook — this function creates the
 * workbook itself (from the shared base) once the collab doc has synced.
 */
export function connectSheetCollab(opts: {
  url: string;
  docId: string;
  univerAPI: FUniverLike;
  /** REST-persisted snapshot, used only to seed the base for a sheet that has
   *  never been opened collaboratively yet (migration / brand-new). */
  initialSnapshot: unknown | null;
  user?: { name: string; email: string };
  /** Called with the workbook snapshot once it's created/loaded, so the host
   *  can create it and start its own REST autosave / name sync. */
  onWorkbookReady: (snapshot: unknown) => void;
  onStatus?: (status: "connecting" | "connected" | "offline") => void;
  onPeers?: (count: number) => void;
  /** Live roster of everyone in the sheet (incl. self), for a presence bar. */
  onParticipants?: (people: Participant[]) => void;
  /** Fired after remote ops are applied, so the host can refresh save-state. */
  onRemoteApplied?: () => void;
  /** A collaborator added, edited or removed a comment. */
  onCommentsChanged?: () => void;
  /** False while this user may not replace the shared workbook (compaction
   *  waits for someone who may). */
  mayReplace?: () => boolean;
  /** The server refused one of our edits (a protected range). */
  onRejected?: () => void;
}): SheetCollabHandle {
  const { url, docId, univerAPI, initialSnapshot, user } = opts;
  const ydoc = new Y.Doc();
  const provider = new HocuspocusProvider({ url, name: docId, document: ydoc });
  const meta = ydoc.getMap<string>("meta");
  const ops = ydoc.getArray<string>("ops");
  const myColor = user ? colorFor(user.email) : PALETTE[0];

  if (user) {
    try {
      provider.setAwarenessField("user", { name: user.name, email: user.email, color: myColor });
    } catch {
      /* awareness optional */
    }
  }

  let ready = false;
  let epoch = ""; // bumped when the whole workbook is replaced (meta.epoch)
  let applied = 0; // number of ops folded into the live workbook
  let applyingRemote = false; // reentrancy guard: don't rebroadcast our own replay
  const disposers: Array<() => void> = [];

  const currentSnapshot = (): unknown => {
    const wb = univerAPI.getActiveWorkbook?.();
    if (!wb) return null;
    return wb.save ? wb.save() : wb.getSnapshot?.() ?? null;
  };

  // Swap the live workbook for `snap` (always keyed to docId so mutations line up).
  const loadWorkbook = (snap: any) => {
    // Univer's selection listener throws if it fires while no workbook is
    // current, which happens while the old one is disposed.
    unbindSelection();
    const prev = univerAPI.getActiveWorkbook?.();
    const prevId = prev?.getId?.();
    if (prevId) {
      try {
        univerAPI.disposeUnit?.(prevId);
      } catch {
        /* already gone */
      }
    }
    createWorkbookFromSnapshot(univerAPI, { ...(snap || {}), id: docId }, { replaced: true });
    cursorShapes.clear(); // the markers went with the old workbook
    bindSelection();
    renderCursors();
  };

  const applyOp = (json: string) => {
    let op: Cmd;
    try {
      op = JSON.parse(json);
    } catch {
      return;
    }
    if (!op?.id) return;
    applyingRemote = true;
    try {
      univerAPI.syncExecuteCommand(op.id, op.params, { fromCollab: true });
    } catch {
      /* a single bad/unknown mutation must not tear down the session */
    } finally {
      applyingRemote = false;
    }
  };

  const applyNewOps = () => {
    const len = ops.length;
    if (len < applied) {
      // Compaction folded ops into a new base; our workbook already reflects
      // them. Just resync our counter — never re-apply.
      applied = len;
      return;
    }
    for (let i = applied; i < len; i++) applyOp(ops.get(i));
    if (len > applied) {
      applied = len;
      opts.onRemoteApplied?.();
    }
  };

  const maybeCompact = () => {
    if (ops.length < COMPACT_THRESHOLD) return;
    const peers = provider.awareness?.getStates().size ?? 1;
    if (peers > 1) return; // race-free only when we're the sole editor
    if (opts.mayReplace && !opts.mayReplace()) return;
    const snap = currentSnapshot();
    if (!snap) return;
    ydoc.transact(() => {
      meta.set("base", JSON.stringify(snap));
      ops.delete(0, ops.length);
    });
    applied = 0;
  };

  // ---- Live presence: remote cursors/selections + participant roster ----
  // Selections are per-user and ephemeral, so they ride Yjs *awareness* (not the
  // op-log). We render each peer's selection as a Univer mark-shape, which the
  // engine positions from the range and keeps glued to the grid as it scrolls.
  let markService: any = null;
  const cursorShapes = new Map<number, string>(); // awareness clientId -> shapeId
  let renderCursors: () => void = () => {};
  let bindSelection: () => void = () => {};
  let selectionSub: { dispose: () => void } | null = null;
  const unbindSelection = () => {
    try {
      selectionSub?.dispose();
    } catch {
      /* already gone */
    }
    selectionSub = null;
  };
  let lastPeopleJson = "";

  const emitParticipants = () => {
    const states = provider.awareness?.getStates();
    if (!states) return;
    const meId = provider.awareness?.clientID;
    const people: Participant[] = [];
    states.forEach((state: any, clientId: number) => {
      const u = state?.user;
      if (!u?.email) return;
      people.push({ name: u.name || u.email, email: u.email, color: u.color || PALETTE[0], self: clientId === meId });
    });
    // De-dupe by email (same person in two tabs), keeping a self entry if any.
    const byEmail = new Map<string, Participant>();
    for (const p of people) {
      const prev = byEmail.get(p.email);
      byEmail.set(p.email, prev ? { ...prev, self: prev.self || p.self } : p);
    }
    const list = [...byEmail.values()];
    const json = JSON.stringify(list);
    if (json === lastPeopleJson) return; // unchanged → don't churn React state
    lastPeopleJson = json;
    opts.onParticipants?.(list);
  };

  const wireCursors = async () => {
    try {
      const mod = await import("@univerjs/sheets-ui");
      // The facade keeps its injector protected; there is no public getter.
      const injector = univerAPI.getInjector?.() ?? (univerAPI as any)._injector;
      markService = injector?.get(mod.IMarkSelectionService);
      if (!markService || !univerAPI.getActiveWorkbook?.()) return;
    } catch {
      return; // presence markers are best-effort; data sync is unaffected
    }

    const activeSheetId = () => univerAPI.getActiveWorkbook?.()?.getActiveSheet?.()?.getSheetId?.();

    // Rendering is coalesced to one animation frame and skips cursors that
    // haven't actually moved. That diff is what makes this loop-proof: awareness
    // fires frequently (heartbeats) and drawing a shape can itself ripple back
    // through awareness — but an unchanged cursor does no work, so any feedback
    // dies out immediately instead of thrashing the main thread.
    const lastKey = new Map<number, string>();
    let raf = 0;
    let renderingNow = false;

    const doRender = () => {
      raf = 0;
      if (renderingNow) return;
      renderingNow = true;
      try {
        const states = provider.awareness?.getStates();
        if (!states) return;
        const meId = provider.awareness?.clientID;
        const sheetId = activeSheetId();
        const seen = new Set<number>();
        states.forEach((state: any, clientId: number) => {
          if (clientId === meId) return;
          const cur = state?.cursor;
          const u = state?.user;
          if (!cur || cur.sheetId !== sheetId) return;
          seen.add(clientId);
          const key = `${u?.color || ""}:${cur.sr},${cur.sc},${cur.er},${cur.ec}`;
          if (lastKey.get(clientId) === key && cursorShapes.has(clientId)) return; // unchanged → no-op
          const old = cursorShapes.get(clientId);
          if (old != null) {
            try {
              markService.removeShape(old);
            } catch {
              /* ignore */
            }
          }
          try {
            const range = { startRow: cur.sr, startColumn: cur.sc, endRow: cur.er, endColumn: cur.ec, rangeType: 0 };
            const id = markService.addShape(
              { range, primary: { actualRow: cur.sr, actualColumn: cur.sc, ...range }, style: markStyle(u?.color || PALETTE[0]) },
              [],
              10000,
            );
            if (id) {
              cursorShapes.set(clientId, id);
              lastKey.set(clientId, key);
            } else {
              cursorShapes.delete(clientId);
              lastKey.delete(clientId);
            }
          } catch {
            cursorShapes.delete(clientId);
            lastKey.delete(clientId);
          }
        });
        // Drop markers for peers who left or moved to another sheet.
        for (const [clientId, shapeId] of [...cursorShapes]) {
          if (!seen.has(clientId)) {
            try {
              markService.removeShape(shapeId);
            } catch {
              /* ignore */
            }
            cursorShapes.delete(clientId);
            lastKey.delete(clientId);
          }
        }
      } finally {
        renderingNow = false;
      }
    };

    const raf0 = typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame : (cb: FrameRequestCallback) => setTimeout(cb, 16) as unknown as number;
    renderCursors = () => {
      if (raf) return;
      raf = raf0(doRender);
    };

    // Broadcast our own selection whenever it settles. The listener belongs to
    // one workbook, so it is re-bound when an import replaces the workbook.
    bindSelection = () => {
      unbindSelection();
      try {
        const wb = univerAPI.getActiveWorkbook?.();
        selectionSub =
          wb?.onSelectionChange?.((ranges: any[]) => {
            const r = ranges?.[0];
            provider.setAwarenessField(
              "cursor",
              r ? { sheetId: activeSheetId(), sr: r.startRow, sc: r.startColumn, er: r.endRow, ec: r.endColumn } : null,
            );
            renderCursors(); // our active sheet may have changed → refresh peers
          }) ?? null;
      } catch {
        /* selection events optional */
      }
    };
    bindSelection();
    disposers.push(unbindSelection);

    disposers.push(() => {
      for (const shapeId of cursorShapes.values()) {
        try {
          markService.removeShape(shapeId);
        } catch {
          /* ignore */
        }
      }
      cursorShapes.clear();
    });

    renderCursors();
  };

  const setup = () => {
    if (ready) return;
    ready = true;

    // 1. Establish the base workbook: the shared one if it exists, else seed it
    //    from the REST snapshot (or a blank workbook keyed to this docId so all
    //    clients share the same unit id and their mutations line up).
    const baseStr = meta.get("base");
    let baseSnap: any;
    if (baseStr) {
      try {
        baseSnap = JSON.parse(baseStr);
      } catch {
        baseSnap = null;
      }
    }
    if (!baseSnap) {
      baseSnap =
        initialSnapshot && typeof initialSnapshot === "object"
          ? { ...(initialSnapshot as object) }
          : { id: docId };
    }
    // A stable, docId-derived unit id is essential: mutations carry unitId, and
    // every client must resolve it to the same workbook for replay to match.
    baseSnap.id = docId;

    createWorkbookFromSnapshot(univerAPI, baseSnap);

    // Seed the shared base if we're the first to open collaboratively. Use the
    // just-created workbook's normalized snapshot so defaults are baked in.
    if (!baseStr) {
      const norm = currentSnapshot();
      if (norm) {
        try {
          (norm as any).id = docId;
        } catch {
          /* ignore */
        }
        meta.set("base", JSON.stringify(norm ?? baseSnap));
      }
    }

    // 2. Replay ops already in the log (edits made while we were away).
    epoch = meta.get("epoch") || "";
    applied = 0;
    applyNewOps();

    // 3. Hand the workbook to the host and go live.
    opts.onWorkbookReady(currentSnapshot());

    // Our own pushes come back through observe in the same tick; they are
    // already applied here, so only count them. Re-applying them doubled
    // inserted/deleted rows and columns for the person who made the change.
    const obs = (event: Y.YArrayEvent<string>) => {
      if (event.transaction.local) {
        applied = ops.length;
        return;
      }
      applyNewOps();
    };
    ops.observe(obs);
    disposers.push(() => ops.unobserve(obs));

    // A peer replaced the whole workbook (opened an .xlsx): reload from the new base.
    const metaObs = () => {
      const next = meta.get("epoch") || "";
      if (next === epoch) return;
      epoch = next;
      let snap: any = null;
      try {
        snap = JSON.parse(meta.get("base") || "null");
      } catch {
        /* keep the current workbook */
      }
      if (!snap) return;
      applyingRemote = true;
      try {
        loadWorkbook(snap);
      } finally {
        applyingRemote = false;
      }
      applied = 0;
      applyNewOps();
      opts.onWorkbookReady(currentSnapshot());
      opts.onRemoteApplied?.();
    };
    meta.observe(metaObs);
    disposers.push(() => meta.unobserve(metaObs));

    const handle = univerAPI.onCommandExecuted((command, options) => {
      if (applyingRemote) return; // our own replay of a peer's op
      if (!isBroadcastable(command, options)) return;
      ops.push([JSON.stringify({ id: command.id, params: command.params })]);
      maybeCompact();
    });
    if (handle) disposers.push(() => handle.dispose());

    // Live presence (remote cursors + roster) — best-effort, after data sync.
    if (PRESENCE_ENABLED) {
      void wireCursors();
      emitParticipants();
    }
  };

  const onStatus = (e: { status: string }) => {
    opts.onStatus?.(e.status === "connected" ? "connected" : e.status === "connecting" ? "connecting" : "offline");
  };
  provider.on("status", onStatus);
  // 4403: the server refused an edit to a protected range. Our copy now holds
  // an op nobody else has, so it can't be kept; the host reloads.
  let rejected = false;
  const onClose = (e: { event?: { code?: number } }) => {
    if (e?.event?.code !== 4403 || rejected) return;
    rejected = true;
    try {
      provider.disconnect();
    } catch {
      /* already down */
    }
    opts.onRejected?.();
  };
  provider.on("close", onClose);
  const onSynced = () => setup();
  provider.on("synced", onSynced);

  // Comments live in the database, not the op log; peers bump a counter in
  // awareness (allowed on read-only connections too) so others refetch.
  const commentRevs = new Map<number, number>();
  const onAware = () => {
    // People, not tabs or panes: one person with a split window is one.
    const people = new Set<string>();
    let anonymous = 0;
    provider.awareness?.getStates().forEach((state: any) => {
      if (state?.user?.email) people.add(state.user.email);
      else anonymous++;
    });
    opts.onPeers?.(Math.max(1, people.size + anonymous));
    let commentsChanged = false;
    provider.awareness?.getStates().forEach((state: any, clientId: number) => {
      if (clientId === provider.awareness?.clientID) return;
      const rev = Number(state?.commentsRev) || 0;
      const prev = commentRevs.get(clientId);
      if (prev !== undefined && prev !== rev) commentsChanged = true;
      commentRevs.set(clientId, rev);
    });
    if (commentsChanged) opts.onCommentsChanged?.();
    if (PRESENCE_ENABLED) {
      emitParticipants();
      renderCursors();
    }
  };
  provider.awareness?.on("change", onAware);

  // Fallback: if the collab server never syncs (offline / blocked), still show
  // the sheet from the REST snapshot after a short grace period. No live sync,
  // but the editor and REST autosave keep working.
  const fallback = setTimeout(() => {
    if (ready) return;
    ready = true;
    const snap =
      initialSnapshot && typeof initialSnapshot === "object" ? { ...(initialSnapshot as object), id: docId } : { id: docId };
    createWorkbookFromSnapshot(univerAPI, snap);
    opts.onWorkbookReady(currentSnapshot());
    opts.onStatus?.("offline");
  }, 5000);

  const replaceWorkbook = (snapshot: unknown) => {
    loadWorkbook(snapshot);
    const norm: any = currentSnapshot();
    if (!norm) return;
    norm.id = docId;
    if (ready) {
      epoch = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      ydoc.transact(() => {
        meta.set("base", JSON.stringify(norm));
        ops.delete(0, ops.length);
        meta.set("epoch", epoch);
      });
      applied = 0;
    }
    opts.onWorkbookReady(norm);
  };

  return {
    provider,
    ydoc,
    replaceWorkbook,
    notifyComments: () => {
      try {
        provider.setAwarenessField("commentsRev", Date.now());
      } catch {
        /* awareness optional */
      }
    },
    destroy: () => {
      clearTimeout(fallback);
      disposers.forEach((d) => {
        try {
          d();
        } catch {
          /* ignore */
        }
      });
      provider.off("status", onStatus);
      provider.off("close", onClose);
      provider.off("synced", onSynced);
      provider.awareness?.off("change", onAware);
      try {
        provider.destroy();
      } catch {
        /* ignore */
      }
      try {
        ydoc.destroy();
      } catch {
        /* ignore */
      }
    },
  };
}
