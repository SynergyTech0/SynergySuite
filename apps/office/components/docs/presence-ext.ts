// Presence per paragraph: a flag in the left margin of each paragraph (or
// table, list...) another person's cursor is in, with their initials and
// colour, the way Word marks where co-authors are working.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import * as Y from "yjs";
import { relativePositionToAbsolutePosition, ySyncPluginKey } from "y-prosemirror";

export const presenceKey = new PluginKey<DecorationSet>("wordPresence");

type Awareness = {
  clientID: number;
  getStates: () => Map<number, Record<string, unknown>>;
  on: (e: string, f: () => void) => void;
  off: (e: string, f: () => void) => void;
};
export type PresencePeer = { name: string; color: string; block: number };

export function initialsOf(name: string): string {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Each other person's cursor, as the top-level block it is in. */
export function peersInBlocks(state: EditorState, awareness: Awareness | null | undefined): PresencePeer[] {
  if (!awareness) return [];
  const ys = ySyncPluginKey.getState(state) as { doc: Y.Doc; type: Y.XmlFragment; binding?: { mapping: Map<unknown, unknown> } } | undefined;
  if (!ys?.binding) return [];
  const out: PresencePeer[] = [];
  awareness.getStates().forEach((st, client) => {
    if (client === awareness.clientID) return;
    const cursor = st.cursor as { head?: unknown } | undefined;
    const user = (st.user || {}) as { name?: string; color?: string };
    if (!cursor?.head) return;
    try {
      const pos = relativePositionToAbsolutePosition(ys.doc, ys.type, Y.createRelativePositionFromJSON(cursor.head), ys.binding!.mapping as never);
      if (pos === null || pos < 0 || pos > state.doc.content.size) return;
      const $p = state.doc.resolve(pos);
      const block = $p.depth >= 1 ? $p.before(1) : pos < state.doc.content.size ? pos : -1;
      if (block < 0 || !state.doc.nodeAt(block)) return;
      out.push({ name: user.name || "Someone", color: user.color || "#6366f1", block });
    } catch {
      /* a position from a document version we do not have yet */
    }
  });
  return out;
}

function build(state: EditorState, awareness: Awareness | null | undefined): DecorationSet {
  const peers = peersInBlocks(state, awareness);
  if (!peers.length) return DecorationSet.empty;
  const byBlock = new Map<number, PresencePeer[]>();
  for (const p of peers) byBlock.set(p.block, [...(byBlock.get(p.block) || []), p]);
  const decos: Decoration[] = [];
  byBlock.forEach((ps, at) => {
    const node = state.doc.nodeAt(at)!;
    decos.push(
      Decoration.node(at, at + node.nodeSize, {
        class: "presence-block",
        "data-presence": ps.map((p) => p.name).join(", "),
        "data-presence-initials": ps.length > 1 ? `${initialsOf(ps[0].name)}+${ps.length - 1}` : initialsOf(ps[0].name),
        style: `--presence-color: ${ps[0].color}`,
        title: `${ps.map((p) => p.name).join(", ")} ${ps.length > 1 ? "are" : "is"} working here`,
      }),
    );
  });
  return DecorationSet.create(state.doc, decos);
}

export const Presence = Extension.create<{ awareness: () => Awareness | null | undefined }>({
  name: "wordPresence",
  addOptions() {
    return { awareness: () => null };
  },
  addProseMirrorPlugins() {
    const get = this.options.awareness;
    return [
      new Plugin<DecorationSet>({
        key: presenceKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old, _o, state) {
            if (tr.getMeta(presenceKey) || tr.docChanged) return build(state, get());
            return old;
          },
        },
        props: { decorations: (state) => presenceKey.getState(state) },
        view(view) {
          const aw = get();
          let raf = 0;
          const changed = () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
              if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(presenceKey, true).setMeta("addToHistory", false));
            });
          };
          aw?.on("change", changed);
          return {
            destroy() {
              cancelAnimationFrame(raf);
              aw?.off("change", changed);
            },
          };
        },
      }),
    ];
  },
});
