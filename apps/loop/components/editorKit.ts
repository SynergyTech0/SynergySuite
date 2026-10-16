"use client";
// The Tiptap extensions shared by pages and the rich components (lists, checklist, table, text).
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { AnyExtension } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";
import type * as Y from "yjs";
import { type Me, colorFor } from "./client";

export function editorKit(doc: Y.Doc, provider: HocuspocusProvider, me: Me, placeholder: string): AnyExtension[] {
  return [
    // Undo and redo come from the shared document, so each person only undoes their own changes.
    StarterKit.configure({ history: false }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Link.configure({ openOnClick: true, autolink: true, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } }),
    Placeholder.configure({ placeholder }),
    Collaboration.configure({ document: doc, field: "default" }),
    CollaborationCursor.configure({ provider, user: { name: me.name || me.email, email: me.email, color: colorFor(me.email) } }),
  ];
}
