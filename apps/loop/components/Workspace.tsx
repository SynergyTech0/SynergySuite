"use client";
import { ChevronDown, ChevronRight, FilePlus, FileText, Home, MoreHorizontal, Plus, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type Me, type Role, api, colorFor, initials, relTime } from "./client";
import { Confirm, Prompt } from "./Modal";
import { type PageInfo, PageEditor } from "./PageEditor";
import { WorkspaceShare } from "./Share";

type Page = { id: string; parent_id: string | null; title: string; emoji: string; position: number; modified_at: string; modified_by: string | null };
type Ws = { id: string; name: string; emoji: string; owner: string; role: Role; members: { email: string; role: string }[]; pages: Page[] };

function Tree({ pages, parent, depth, current, open, toggle, onOpen, onAdd, onDelete, canEdit }: {
  pages: Page[]; parent: string | null; depth: number; current: string | null; open: Set<string>; toggle: (id: string) => void;
  onOpen: (id: string) => void; onAdd: (parent: string) => void; onDelete: (p: Page) => void; canEdit: boolean;
}) {
  const kids = pages.filter((p) => p.parent_id === parent);
  return (
    <>
      {kids.map((p) => {
        const hasKids = pages.some((c) => c.parent_id === p.id);
        const isOpen = open.has(p.id);
        return (
          <div key={p.id}>
            <div className={`navitem page${p.id === current ? " active" : ""}`} style={{ paddingLeft: 6 + depth * 14 }}>
              <button className="iconbtn small" aria-label={isOpen ? "Collapse" : "Expand"} onClick={() => toggle(p.id)} style={{ visibility: hasKids ? "visible" : "hidden" }}>
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <button className="navlabel" onClick={() => onOpen(p.id)}>
                {p.emoji ? <span>{p.emoji}</span> : <FileText size={15} />}
                <span className="fname">{p.title || "Untitled page"}</span>
              </button>
              {canEdit && (
                <span className="navactions">
                  <button className="iconbtn small" title="Add a page inside" aria-label="Add a page inside" onClick={() => onAdd(p.id)}>
                    <Plus size={14} />
                  </button>
                  <button className="iconbtn small" title="Delete page" aria-label="Delete page" onClick={() => onDelete(p)}>
                    <Trash2 size={14} />
                  </button>
                </span>
              )}
            </div>
            {hasKids && isOpen && (
              <Tree pages={pages} parent={p.id} depth={depth + 1} current={current} open={open} toggle={toggle} onOpen={onOpen} onAdd={onAdd} onDelete={onDelete} canEdit={canEdit} />
            )}
          </div>
        );
      })}
    </>
  );
}

export function WorkspaceView({ id, initialPage, me, collabUrl }: { id: string; initialPage: string | null; me: Me; collabUrl: string }) {
  const [ws, setWs] = useState<Ws | null>(null);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState<string | null>(initialPage);
  const [page, setPage] = useState<PageInfo | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<"share" | "rename" | "delete" | { deletePage: Page } | null>(null);
  const [more, setMore] = useState(false);

  const load = useCallback(async () => {
    try {
      setWs(await api<Ws>(`/api/workspaces/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  // Other people add and rename pages too; pick that up every so often and when coming back.
  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 15_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // Open the first page when none is picked, and keep the address in step with the open page.
  useEffect(() => {
    if (!ws) return;
    if (!current || !ws.pages.some((p) => p.id === current)) {
      const first = ws.pages.find((p) => !p.parent_id) ?? null;
      if (first?.id !== current) setCurrent(first?.id ?? null);
    }
  }, [ws, current]);

  useEffect(() => {
    if (!current) {
      setPage(null);
      return;
    }
    const url = new URL(window.location.href);
    if (url.searchParams.get("page") !== current) {
      url.searchParams.set("page", current);
      window.history.replaceState(null, "", url);
    }
    let gone = false;
    api<PageInfo>(`/api/pages/${current}`).then(
      (p) => !gone && setPage(p),
      (e) => !gone && setError(e.message),
    );
    // Show the way to the open page in the tree.
    setOpen((o) => {
      const next = new Set(o);
      let p = ws?.pages.find((x) => x.id === current);
      while (p?.parent_id) {
        next.add(p.parent_id);
        p = ws?.pages.find((x) => x.id === p!.parent_id);
      }
      return next;
    });
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const addPage = async (parentId: string | null) => {
    try {
      const p = await api<Page>("/api/pages", { method: "POST", json: { workspaceId: id, parentId, title: "" } });
      if (parentId) setOpen((o) => new Set(o).add(parentId));
      await load();
      setCurrent(p.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const canEdit = ws?.role === "owner" || ws?.role === "editor";
  const editors = useMemo(() => ws?.members ?? [], [ws]);

  if (error && !ws) {
    return (
      <div className="pad">
        <h1>Can&apos;t open this workspace</h1>
        <p className="muted">{error}</p>
        <a className="btn" href="/">Back to Loop</a>
      </div>
    );
  }
  if (!ws) return <div className="pad muted">Loading…</div>;

  return (
    <div className="loop">
      <nav className="nav" aria-label="Pages">
        <a className="navitem" href="/">
          <Home size={16} /> Loop home
        </a>
        <div className="wshead">
          <span className="wsemoji">{ws.emoji || ws.name.slice(0, 1).toUpperCase()}</span>
          <strong className="fname">{ws.name}</strong>
          <span className="wrap">
            <button className="iconbtn small" aria-label="Workspace options" onClick={() => setMore(!more)}>
              <MoreHorizontal size={16} />
            </button>
            {more && (
              <div className="menu right" role="menu" onMouseLeave={() => setMore(false)}>
                <button role="menuitem" onClick={() => (setMore(false), setDialog("share"))}>Share</button>
                {canEdit && <button role="menuitem" onClick={() => (setMore(false), setDialog("rename"))}>Rename</button>}
                {ws.role === "owner" && <button role="menuitem" className="danger" onClick={() => (setMore(false), setDialog("delete"))}>Delete workspace</button>}
              </div>
            )}
          </span>
        </div>
        <button className="members" onClick={() => setDialog("share")} title="Who is in this workspace">
          {editors.slice(0, 6).map((m) => (
            <span key={m.email} className="avatar small" style={{ background: colorFor(m.email) }} title={m.email}>
              {initials(m.email)}
            </span>
          ))}
          <Users size={14} /> <span className="small">{editors.length === 1 ? "Just you" : `${editors.length} people`}</span>
        </button>
        <div className="navsection">
          Pages
          {canEdit && (
            <button className="iconbtn small" aria-label="New page" title="New page" onClick={() => addPage(null)}>
              <FilePlus size={15} />
            </button>
          )}
        </div>
        <Tree
          pages={ws.pages}
          parent={null}
          depth={0}
          current={current}
          open={open}
          toggle={(pid) => setOpen((o) => {
            const n = new Set(o);
            if (n.has(pid)) n.delete(pid);
            else n.add(pid);
            return n;
          })}
          onOpen={setCurrent}
          onAdd={(pid) => addPage(pid)}
          onDelete={(p) => setDialog({ deletePage: p })}
          canEdit={!!canEdit}
        />
        {!ws.pages.length && <p className="muted small navhint">No pages yet.</p>}
      </nav>
      <main className="pagearea">
        {page && page.id === current ? (
          <>
            <PageEditor
              key={page.id}
              page={page}
              me={me}
              collabUrl={collabUrl}
              onRename={async (title) => {
                try {
                  await api(`/api/pages/${page.id}`, { method: "PATCH", json: { title } });
                  setPage({ ...page, title });
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
            <p className="pagefoot muted small">
              Edited {relTime(ws.pages.find((p) => p.id === page.id)?.modified_at ?? page.modified_at)}
            </p>
          </>
        ) : (
          <div className="pad muted">{current ? "Loading…" : canEdit ? "Add a page to get started." : "This workspace has no pages yet."}</div>
        )}
      </main>

      {dialog === "share" && <WorkspaceShare id={id} me={me} role={ws.role} members={ws.members} onClose={() => setDialog(null)} onChanged={load} />}
      {dialog === "rename" && (
        <Prompt
          title="Rename workspace"
          label="Name"
          initial={ws.name}
          action="Rename"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            await api(`/api/workspaces/${id}`, { method: "PATCH", json: { name } });
            await load();
          }}
        />
      )}
      {dialog === "delete" && (
        <Confirm
          title="Delete workspace"
          danger
          action="Delete"
          message={`Delete ${ws.name} and all its pages for everyone? Components made in it stay with the people who made them.`}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api(`/api/workspaces/${id}`, { method: "DELETE" });
            window.location.href = "/";
          }}
        />
      )}
      {dialog && typeof dialog === "object" && (
        <Confirm
          title="Delete page"
          danger
          action="Delete"
          message={`Delete "${dialog.deletePage.title || "Untitled page"}" and any pages inside it, for everyone?`}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api(`/api/pages/${dialog.deletePage.id}`, { method: "DELETE" });
            if (current === dialog.deletePage.id) setCurrent(null);
            await load();
          }}
        />
      )}
    </div>
  );
}
