"use client";
// One live component, wherever it is shown: on a page, in its own window, or inside a Chat
// message. Its content is its own shared document, so every copy is the same component.
import { EditorContent, useEditor } from "@tiptap/react";
import { ExternalLink, Link2, Share2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { kindInfo } from "@/lib/ydoc.mjs";
import { type Collab, type Me, type Role, api, colorFor, componentLink, initials, useCollab } from "./client";
import { editorKit } from "./editorKit";
import { KindIcon } from "./KindIcon";
import { ComponentShare } from "./Share";
import { ProgressView, QAView, TasksView, VotingView } from "./Structured";

export type ComponentInfo = {
  id: string; kind: string; title: string; owner: string; role: Role; workspace_id: string | null; workspace_name: string | null;
  link_access: "org-edit" | "org-view" | "people"; members: { email: string; role: string }[];
};

function RichComponent({ collab, me, readOnly, kind }: { collab: Collab; me: Me; readOnly: boolean; kind: string }) {
  const editor = useEditor(
    {
      extensions: editorKit(collab.doc, collab.provider, me, kind === "table" ? "" : "Type here…"),
      editable: !readOnly,
      immediatelyRender: false,
      editorProps: { attributes: { class: `prose rich ${kind}`, "aria-label": kindInfo(kind)?.name ?? "Component" } },
    },
    [collab.doc, collab.provider],
  );
  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);
  return <EditorContent editor={editor} />;
}

export function ComponentBody({ info, me, collabUrl }: { info: ComponentInfo; me: Me; collabUrl: string }) {
  const collab = useCollab(`component:${info.id}`, collabUrl, me);
  if (!collab?.synced) return <div className="cbody muted small">{collab?.problem || "Loading…"}</div>;
  const readOnly = info.role === "viewer";
  const people = [...new Set([...info.members.map((m) => m.email), ...collab.people.map((p) => p.email), me.email])];
  const props = { doc: collab.doc, me, readOnly, people };
  return (
    <div className="cbody">
      {collab.problem && <p className="error small">{collab.problem}</p>}
      {info.kind === "tasks" ? (
        <TasksView {...props} />
      ) : info.kind === "voting" ? (
        <VotingView {...props} />
      ) : info.kind === "progress" ? (
        <ProgressView {...props} />
      ) : info.kind === "qa" ? (
        <QAView {...props} />
      ) : (
        <RichComponent collab={collab} me={me} readOnly={readOnly} kind={info.kind} />
      )}
      <Presence people={collab.people} />
    </div>
  );
}

export function Presence({ people }: { people: Collab["people"] }) {
  if (!people.length) return null;
  return (
    <div className="presence" aria-label={`Also here: ${people.map((p) => p.name).join(", ")}`}>
      {people.slice(0, 5).map((p) => (
        <span key={p.email} className="avatar small" style={{ background: p.color || colorFor(p.email) }} title={`${p.name} is here`}>
          {initials(p.name || p.email)}
        </span>
      ))}
      {people.length > 5 && <span className="muted small">+{people.length - 5}</span>}
    </div>
  );
}

/**
 * The card around a component. `where` says what it sits in: a page (it can be taken off the
 * page), its own window, or an embed in another app (a link opens it in Loop).
 */
export function ComponentCard({ id, me, collabUrl, where, onRemove }: {
  id: string; me: Me; collabUrl: string; where: "page" | "window" | "embed"; onRemove?: () => void;
}) {
  const [info, setInfo] = useState<ComponentInfo | null>(null);
  const [error, setError] = useState("");
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo(await api<ComponentInfo>(`/api/components/${id}${where === "page" ? "?quiet=1" : ""}`));
      setError("");
    } catch (e) {
      setError((e as { status?: number }).status === 404 ? "This component was deleted, or it isn't shared with you." : (e as Error).message);
    }
  }, [id, where]);
  useEffect(() => {
    void load();
  }, [load]);

  const rename = async (title: string) => {
    if (!info || !title.trim() || title === info.title) return;
    setInfo({ ...info, title });
    await api(`/api/components/${id}`, { method: "PATCH", json: { title } }).catch((e) => setError(e.message));
  };

  if (error && !info) {
    return (
      <div className={`ccard ${where}`} contentEditable={false}>
        <div className="chead">
          <span className="muted small grow">{error}</span>
          {onRemove && (
            <button className="iconbtn small" aria-label="Take off this page" onClick={onRemove}>
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    );
  }
  if (!info) return <div className={`ccard ${where} muted small`}>Loading…</div>;
  const canEdit = info.role !== "viewer";

  return (
    <div className={`ccard ${where}`} contentEditable={false} data-component={id}>
      <div className="chead">
        <KindIcon kind={info.kind} />
        <input
          className="ctitle"
          defaultValue={info.title}
          key={info.title}
          readOnly={!canEdit}
          aria-label="Component name"
          onBlur={(e) => void rename(e.target.value.trim())}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <span className="badge" title="Changes show up everywhere this component is shared">Live</span>
        {info.role === "viewer" && <span className="badge muted">View only</span>}
        <button
          className="iconbtn small"
          title="Copy link: paste it in a chat or a page to share this live component"
          aria-label="Copy link"
          onClick={async () => {
            await navigator.clipboard.writeText(componentLink(id)).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          <Link2 size={15} />
        </button>
        {copied && <span className="small ok">Copied</span>}
        {canEdit && (
          <button className="iconbtn small" title="Share" aria-label="Share" onClick={() => setSharing(true)}>
            <Share2 size={15} />
          </button>
        )}
        {where !== "window" && (
          <a className="iconbtn small" href={`/c/${id}`} target={where === "embed" ? "_blank" : undefined} rel="noopener" title="Open in Loop" aria-label="Open in Loop">
            <ExternalLink size={15} />
          </a>
        )}
        {onRemove && (
          <button className="iconbtn small" title="Take off this page (the component itself stays)" aria-label="Take off this page" onClick={onRemove}>
            <X size={15} />
          </button>
        )}
      </div>
      <ComponentBody info={info} me={me} collabUrl={collabUrl} />
      {sharing && <ComponentShare info={info} me={me} onClose={() => setSharing(false)} onChanged={load} />}
    </div>
  );
}
