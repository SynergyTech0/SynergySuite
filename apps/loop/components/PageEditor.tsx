"use client";
// A workspace page: shared rich text with live components placed in it. Type "/" on an empty
// line for the insert menu.
import { EditorContent, type Editor, useEditor } from "@tiptap/react";
import { Bold, CheckSquare, Heading1, Heading2, Italic, List, ListOrdered, Plus, Sparkles, Table as TableIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { markdownToHtml } from "@/lib/markdown";
import { KINDS } from "@/lib/ydoc.mjs";
import { type Collab, type Me, type Role, api, useCollab } from "./client";
import { Presence } from "./ComponentCard";
import { editorKit } from "./editorKit";
import { KindIcon } from "./KindIcon";
import { LoopComponentNode, LoopContext } from "./LoopNode";
import { Modal } from "./Modal";

export type PageInfo = { id: string; title: string; emoji: string; role: Role; workspace_id: string; modified_at: string; modified_by: string | null };

type MenuItem = { id: string; label: string; hint?: string; icon: React.ReactNode; group: string; run: (e: Editor) => void | Promise<void> };

function blocks(): MenuItem[] {
  return [
    { id: "h1", label: "Heading", icon: <Heading1 size={16} />, group: "Text", run: (e) => void e.chain().focus().toggleHeading({ level: 2 }).run() },
    { id: "h2", label: "Subheading", icon: <Heading2 size={16} />, group: "Text", run: (e) => void e.chain().focus().toggleHeading({ level: 3 }).run() },
    { id: "ul", label: "Bullets", icon: <List size={16} />, group: "Text", run: (e) => void e.chain().focus().toggleBulletList().run() },
    { id: "ol", label: "Numbers", icon: <ListOrdered size={16} />, group: "Text", run: (e) => void e.chain().focus().toggleOrderedList().run() },
    { id: "todo", label: "Checklist", icon: <CheckSquare size={16} />, group: "Text", run: (e) => void e.chain().focus().toggleTaskList().run() },
    {
      id: "table", label: "Table", icon: <TableIcon size={16} />, group: "Text",
      run: (e) => void e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
  ];
}

/** Makes a new component and puts it where the cursor is. */
async function insertComponent(editor: Editor, workspaceId: string, kind: string, extra: Record<string, unknown> = {}) {
  const c = await api<{ id: string }>("/api/components", { method: "POST", json: { kind, workspaceId, ...extra } });
  editor.chain().focus().insertContent([{ type: "loopComponent", attrs: { componentId: c.id } }, { type: "paragraph" }]).run();
}

function InsertMenu({ editor, workspaceId, at, onClose, onError }: {
  editor: Editor; workspaceId: string; at: { left: number; top: number } | null; onClose: () => void; onError: (m: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const items: MenuItem[] = [
    ...KINDS.map((k) => ({
      id: k.id, label: k.name, hint: k.hint, icon: <KindIcon kind={k.id} />, group: "Live components",
      run: (e: Editor) => insertComponent(e, workspaceId, k.id),
    })),
    ...blocks(),
  ];
  useEffect(() => {
    ref.current?.querySelector("button")?.focus();
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [onClose]);
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <div
      ref={ref}
      className="menu insertmenu"
      role="menu"
      style={at ? { position: "fixed", left: at.left, top: at.top } : undefined}
      onKeyDown={(e) => {
        const buttons = [...(ref.current?.querySelectorAll("button") ?? [])];
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === "ArrowDown") buttons[(i + 1) % buttons.length]?.focus();
        else if (e.key === "ArrowUp") buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
        else if (e.key === "Escape") {
          onClose();
          editor.commands.focus();
        } else return;
        e.preventDefault();
      }}
    >
      {groups.map((g) => (
        <div key={g}>
          <div className="menugroup">{g}</div>
          {items
            .filter((i) => i.group === g)
            .map((i) => (
              <button
                key={i.id}
                role="menuitem"
                onClick={async () => {
                  onClose();
                  try {
                    await i.run(editor);
                  } catch (x) {
                    onError((x as Error).message);
                  }
                }}
              >
                {i.icon}
                <span className="grow">
                  {i.label}
                  {i.hint && <span className="muted small block">{i.hint}</span>}
                </span>
              </button>
            ))}
        </div>
      ))}
    </div>
  );
}

function Copilot({ editor, workspaceId, onError }: { editor: Editor; workspaceId: string; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState("");
  const run = async (label: string, fn: () => Promise<void>) => {
    setOpen(false);
    setBusy(label);
    try {
      await fn();
    } catch (x) {
      onError((x as Error).message);
    } finally {
      setBusy("");
    }
  };
  const context = () => editor.getText({ blockSeparator: "\n" }).slice(0, 20_000);
  return (
    <span className="wrap">
      <button className="btn small ghost" onClick={() => setOpen(!open)} disabled={!!busy} aria-expanded={open}>
        <Sparkles size={15} /> {busy || "Copilot"}
      </button>
      {open && (
        <div className="menu right" role="menu">
          <button role="menuitem" onClick={() => (setOpen(false), setDrafting(true))}>Draft something…</button>
          <button
            role="menuitem"
            onClick={() =>
              run("Summarizing…", async () => {
                const { markdown } = await api<{ markdown: string }>("/api/ai", { method: "POST", json: { mode: "summarize", context: context() } });
                editor.chain().focus("start").insertContent(`<h3>Summary</h3>${markdownToHtml(markdown)}`).run();
              })
            }
          >
            Summarize this page
          </button>
          <button
            role="menuitem"
            onClick={() =>
              run("Finding tasks…", async () => {
                const { tasks } = await api<{ tasks: unknown[] }>("/api/ai", { method: "POST", json: { mode: "tasks", context: context() } });
                if (!tasks.length) throw new Error("Copilot didn't find any action items on this page.");
                editor.commands.focus("end");
                await insertComponent(editor, workspaceId, "tasks", { title: "Action items", items: tasks });
              })
            }
          >
            Turn action items into a task list
          </button>
        </div>
      )}
      {drafting && (
        <Modal title="Draft with Copilot" onClose={() => setDrafting(false)}>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              const prompt = (e.currentTarget.elements.namedItem("prompt") as HTMLTextAreaElement).value;
              setDrafting(false);
              void run("Writing…", async () => {
                const { markdown } = await api<{ markdown: string }>("/api/ai", { method: "POST", json: { mode: "draft", prompt, context: context() } });
                editor.chain().focus().insertContent(markdownToHtml(markdown)).run();
              });
            }}
          >
            <label>
              <span>What should Copilot write?</span>
              <textarea name="prompt" rows={4} autoFocus required placeholder="An agenda for Thursday's planning meeting" />
            </label>
            <div className="actions">
              <button type="button" className="btn" onClick={() => setDrafting(false)}>Cancel</button>
              <button className="btn primary">Write</button>
            </div>
          </form>
        </Modal>
      )}
    </span>
  );
}

function Toolbar({ editor, workspaceId, ai, onError }: { editor: Editor; workspaceId: string; ai: boolean; onError: (m: string) => void }) {
  const [menu, setMenu] = useState(false);
  const [, force] = useState(0);
  useEffect(() => {
    const on = () => force((n) => n + 1);
    editor.on("selectionUpdate", on);
    editor.on("transaction", on);
    return () => {
      editor.off("selectionUpdate", on);
      editor.off("transaction", on);
    };
  }, [editor]);
  const b = (label: string, icon: React.ReactNode, active: boolean, run: () => void) => (
    <button className={`iconbtn${active ? " on" : ""}`} title={label} aria-label={label} aria-pressed={active} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {icon}
    </button>
  );
  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <span className="wrap">
        <button className="btn small primary" onClick={() => setMenu(!menu)} aria-expanded={menu}>
          <Plus size={15} /> Insert
        </button>
        {menu && <InsertMenu editor={editor} workspaceId={workspaceId} at={null} onClose={() => setMenu(false)} onError={onError} />}
      </span>
      <span className="sep" />
      {b("Bold", <Bold size={16} />, editor.isActive("bold"), () => editor.chain().focus().toggleBold().run())}
      {b("Italic", <Italic size={16} />, editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run())}
      {b("Heading", <Heading1 size={16} />, editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run())}
      {b("Bullets", <List size={16} />, editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run())}
      {b("Numbers", <ListOrdered size={16} />, editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run())}
      {b("Checklist", <CheckSquare size={16} />, editor.isActive("taskList"), () => editor.chain().focus().toggleTaskList().run())}
      {ai && (
        <>
          <span className="sep" />
          <Copilot editor={editor} workspaceId={workspaceId} onError={onError} />
        </>
      )}
    </div>
  );
}

function PageBody({ collab, page, me, readOnly, ai, onError, toolbarSlot }: {
  collab: Collab; page: PageInfo; me: Me; readOnly: boolean; ai: boolean; onError: (m: string) => void; toolbarSlot: HTMLElement | null;
}) {
  const [slash, setSlash] = useState<{ left: number; top: number } | null>(null);
  const editor = useEditor(
    {
      extensions: [...editorKit(collab.doc, collab.provider, me, "Type / to add a live component, or just start writing"), LoopComponentNode],
      editable: !readOnly,
      immediatelyRender: false,
      editorProps: {
        attributes: { class: "prose page", "aria-label": "Page" },
        handleKeyDown(view, event) {
          if (event.key !== "/" || !view.editable) return false;
          const { $from, empty } = view.state.selection;
          if (!empty || $from.parent.textContent !== "") return false;
          const c = view.coordsAtPos($from.pos);
          setSlash({ left: c.left, top: c.bottom + 6 });
          return true;
        },
      },
    },
    [collab.doc, collab.provider],
  );
  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);
  if (!editor) return null;
  return (
    <>
      {!readOnly && toolbarSlot && createPortal(<Toolbar editor={editor} workspaceId={page.workspace_id} ai={ai} onError={onError} />, toolbarSlot)}
      <EditorContent editor={editor} />
      {slash && <InsertMenu editor={editor} workspaceId={page.workspace_id} at={slash} onClose={() => setSlash(null)} onError={onError} />}
    </>
  );
}

export function PageEditor({ page, me, collabUrl, onRename }: {
  page: PageInfo; me: Me; collabUrl: string; onRename: (title: string) => void;
}) {
  const collab = useCollab(`page:${page.id}`, collabUrl, me);
  const readOnly = page.role === "viewer";
  const [error, setError] = useState("");
  const [ai, setAi] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    api<{ enabled: boolean }>("/api/ai").then((r) => setAi(r.enabled), () => setAi(false));
  }, []);

  return (
    <LoopContext.Provider value={{ me, collabUrl }}>
      <div className="pagewrap">
        <div className="pagehead">
          <input
            className="pagetitle"
            key={page.id + page.title}
            defaultValue={page.title}
            placeholder="Untitled page"
            readOnly={readOnly}
            aria-label="Page title"
            onBlur={(e) => e.target.value.trim() !== page.title && onRename(e.target.value.trim())}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), (e.target as HTMLInputElement).blur())}
          />
          {collab && <Presence people={collab.people} />}
        </div>
        <div ref={setSlot} className="toolbarslot" />
        {readOnly && <p className="muted small">You can view this page. Ask the workspace owner if you need to change it.</p>}
        {error && (
          <p className="error small" role="alert">
            {error} <button className="linkbtn" onClick={() => setError("")}>Dismiss</button>
          </p>
        )}
        {!collab?.synced ? (
          <p className="muted">{collab?.problem || "Loading…"}</p>
        ) : (
          <>
            {collab.problem && <p className="error small">{collab.problem}</p>}
            <PageBody collab={collab} page={page} me={me} readOnly={readOnly} ai={ai} onError={setError} toolbarSlot={slot} />
          </>
        )}
      </div>
    </LoopContext.Provider>
  );
}
