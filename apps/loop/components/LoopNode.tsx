"use client";
// A live component placed on a page. The page only holds the component's id; the content lives
// in the component's own shared document, so it can sit on several pages and chats at once.
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, type NodeViewProps, ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { createContext, useContext } from "react";
import type { Me } from "./client";
import { ComponentCard } from "./ComponentCard";

export const LoopContext = createContext<{ me: Me; collabUrl: string }>({ me: { email: "", name: "" }, collabUrl: "" });

const LINK = /^https?:\/\/[^/\s]+\/(?:c|embed)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

/** The component id in a Loop component link, if the text is one. */
export function componentIdFromLink(text: string): string | null {
  const m = LINK.exec(text.trim());
  return m ? m[1].toLowerCase() : null;
}

function View({ node, deleteNode, editor }: NodeViewProps) {
  const { me, collabUrl } = useContext(LoopContext);
  const id = node.attrs.componentId as string | null;
  return (
    <NodeViewWrapper className="loopnode">
      {id ? (
        <ComponentCard id={id} me={me} collabUrl={collabUrl} where="page" onRemove={editor.isEditable ? deleteNode : undefined} />
      ) : null}
    </NodeViewWrapper>
  );
}

export const LoopComponentNode = Node.create({
  name: "loopComponent",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      componentId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-component-id"),
        renderHTML: (a) => ({ "data-component-id": a.componentId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-loop-component]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-loop-component": "" })];
  },

  addNodeView() {
    // Typing, clicks and keys inside the card belong to the component, not to the page around it.
    return ReactNodeViewRenderer(View, { stopEvent: () => true, ignoreMutation: () => true });
  },

  addProseMirrorPlugins() {
    const type = this.type;
    return [
      new Plugin({
        key: new PluginKey("loopComponentPaste"),
        props: {
          // Pasting a component's link puts the live component on the page.
          handlePaste(view, event) {
            const text = event.clipboardData?.getData("text/plain") ?? "";
            const id = componentIdFromLink(text);
            if (!id) return false;
            view.dispatch(view.state.tr.replaceSelectionWith(type.create({ componentId: id })).scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
