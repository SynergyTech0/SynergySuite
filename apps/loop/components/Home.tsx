"use client";
import { FileText, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { KINDS } from "@/lib/ydoc.mjs";
import { type Me, api, relTime } from "./client";
import { KindIcon } from "./KindIcon";
import { Modal } from "./Modal";

type Workspace = { id: string; name: string; emoji: string; owner: string; role: string; pages: number; modified_at: string };
type Recent = { kind: "page" | "component"; id: string; title: string; emoji: string; detail: string; at: string; workspace_id: string | null };
type Component = { id: string; kind: string; title: string; owner: string; workspace_name: string | null; modified_at: string };

const EMOJI = ["📋", "🚀", "🎯", "💡", "📅", "🧭", "🛠️", "📈", "🤝", "🌱"];

function NewWorkspace({ onClose }: { onClose: () => void }) {
  const [emoji, setEmoji] = useState(EMOJI[0]);
  const [error, setError] = useState("");
  return (
    <Modal title="New workspace" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const name = (e.currentTarget.elements.namedItem("name") as HTMLInputElement).value;
          try {
            const w = await api<{ id: string; pageId: string }>("/api/workspaces", { method: "POST", json: { name, emoji } });
            window.location.href = `/w/${w.id}?page=${w.pageId}`;
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        <label>
          <span>Name</span>
          <input name="name" autoFocus required maxLength={120} placeholder="Product launch" />
        </label>
        <div className="emojis" role="radiogroup" aria-label="Icon">
          {EMOJI.map((e) => (
            <button type="button" key={e} role="radio" aria-checked={e === emoji} className={e === emoji ? "on" : ""} onClick={() => setEmoji(e)}>
              {e}
            </button>
          ))}
        </div>
        <p className="muted small">You can add people once it&apos;s made.</p>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Create</button>
        </div>
      </form>
    </Modal>
  );
}

function NewComponent({ onClose }: { onClose: () => void }) {
  const [error, setError] = useState("");
  return (
    <Modal title="New component" onClose={onClose} wide>
      <div className="form">
        <p className="muted small">A component stays in sync everywhere you share it: paste its link in a chat or onto a page.</p>
        <div className="kindgrid">
          {KINDS.map((k) => (
            <button
              key={k.id}
              className="kindcard"
              onClick={async () => {
                try {
                  const c = await api<{ id: string }>("/api/components", { method: "POST", json: { kind: k.id } });
                  window.location.href = `/c/${c.id}`;
                } catch (x) {
                  setError((x as Error).message);
                }
              }}
            >
              <KindIcon kind={k.id} size={20} />
              <strong>{k.name}</strong>
              <span className="muted small">{k.hint}</span>
            </button>
          ))}
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  );
}

export function Home({ me }: { me: Me }) {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [components, setComponents] = useState<Component[]>([]);
  const [dialog, setDialog] = useState<"workspace" | "component" | "about" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api<{ workspaces: Workspace[] }>("/api/workspaces"),
      api<{ items: Recent[] }>("/api/recent"),
      api<{ components: Component[] }>("/api/components"),
    ]).then(
      ([w, r, c]) => {
        setWorkspaces(w.workspaces);
        setRecent(r.items);
        setComponents(c.components);
      },
      (e) => setError(e.message),
    );
  }, []);

  const href = (r: Recent) => (r.kind === "page" ? `/w/${r.workspace_id}?page=${r.id}` : `/c/${r.id}`);

  return (
    <div className="home">
      <header className="homehead">
        <div>
          <h1>Hi {me.name.split(" ")[0] || me.email}</h1>
          <p className="muted">Plan, think and get things done together. Everything here stays live wherever you share it.</p>
        </div>
        <div className="row-actions">
          <button className="btn" onClick={() => setDialog("component")}>
            <Plus size={16} /> New component
          </button>
          <button className="btn primary" onClick={() => setDialog("workspace")}>
            <Plus size={16} /> New workspace
          </button>
        </div>
      </header>
      {error && <p className="error">{error}</p>}

      <section>
        <h3>Workspaces</h3>
        {workspaces === null ? (
          <p className="muted">Loading…</p>
        ) : workspaces.length === 0 ? (
          <div className="empty">
            <p>No workspaces yet. A workspace keeps a project&apos;s pages and components together, shared with the people on it.</p>
            <button className="btn primary" onClick={() => setDialog("workspace")}>Create your first workspace</button>
          </div>
        ) : (
          <div className="wsgrid">
            {workspaces.map((w) => (
              <a key={w.id} className="wscard" href={`/w/${w.id}`}>
                <span className="wsemoji big">{w.emoji || w.name.slice(0, 1).toUpperCase()}</span>
                <strong className="fname">{w.name}</strong>
                <span className="muted small">
                  {w.pages} {w.pages === 1 ? "page" : "pages"} · {w.role === "owner" ? "Yours" : `Shared by ${w.owner}`}
                </span>
              </a>
            ))}
          </div>
        )}
      </section>

      <div className="homecols">
        <section>
          <h3>Recent</h3>
          {recent.length === 0 ? (
            <p className="muted small">Pages and components you open show up here.</p>
          ) : (
            <ul className="list">
              {recent.map((r) => (
                <li key={`${r.kind}-${r.id}`}>
                  <a href={href(r)}>
                    {r.kind === "page" ? (r.emoji ? <span>{r.emoji}</span> : <FileText size={16} />) : <KindIcon kind={KINDS.find((k) => k.name === r.detail)?.id ?? "note"} />}
                    <span className="fname">{r.title || "Untitled page"}</span>
                    <span className="muted small">{r.detail}</span>
                    <span className="muted small nowrap">{relTime(r.at)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3>My components</h3>
          {components.length === 0 ? (
            <p className="muted small">Components you make or are added to show up here.</p>
          ) : (
            <ul className="list">
              {components.map((c) => (
                <li key={c.id}>
                  <a href={`/c/${c.id}`}>
                    <KindIcon kind={c.kind} />
                    <span className="fname">{c.title}</span>
                    {c.workspace_name && <span className="muted small">{c.workspace_name}</span>}
                    <span className="muted small nowrap">{relTime(c.modified_at)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer className="muted small">
        <button className="linkbtn" onClick={() => setDialog("about")}>About Synergy Loop</button>
      </footer>

      {dialog === "about" && (
        <Modal title="About Synergy Loop" onClose={() => setDialog(null)}>
          <div className="form">
            <p>Synergy Loop is part of Synergy Suite, licensed under the AGPL-3.0.</p>
            <p>It is built on open source projects, with thanks to their authors:</p>
            <ul className="credits">
              <li><a href="https://tiptap.dev" target="_blank" rel="noopener noreferrer">Tiptap</a> (MIT), the page and component editor</li>
              <li><a href="https://github.com/ueberdosis/hocuspocus" target="_blank" rel="noopener noreferrer">Hocuspocus</a> (MIT), the live collaboration server</li>
              <li><a href="https://yjs.dev" target="_blank" rel="noopener noreferrer">Yjs</a> (MIT), the shared documents that merge everyone&apos;s changes</li>
              <li><a href="https://prosemirror.net" target="_blank" rel="noopener noreferrer">ProseMirror</a> (MIT), the editing engine under Tiptap</li>
              <li><a href="https://lucide.dev" target="_blank" rel="noopener noreferrer">Lucide</a> (ISC), the icons</li>
            </ul>
          </div>
        </Modal>
      )}
      {dialog === "workspace" && <NewWorkspace onClose={() => setDialog(null)} />}
      {dialog === "component" && <NewComponent onClose={() => setDialog(null)} />}
    </div>
  );
}
