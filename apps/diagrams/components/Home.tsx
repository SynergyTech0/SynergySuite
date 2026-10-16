"use client";
import { Copy, Download, FilePlus2, FolderOpen, LayoutTemplate, MoreHorizontal, Pencil, Search, Share2, Sparkles, Trash2, Upload, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CATEGORIES, FEATURED, TEMPLATES, type Template, templatePreviewUrl, templateXmlUrl } from "@/lib/templates";
import type { DiagramInfo, View } from "@/lib/types";
import { api, person, when } from "./client";
import { ACCEPT, fileToXml, stem } from "./importer";
import { Confirm, Modal, Prompt } from "./Modal";
import { ShareDialog } from "./ShareDialog";

const VIEWS: { id: View; label: string }[] = [
  { id: "recent", label: "Recent" },
  { id: "mine", label: "My diagrams" },
  { id: "shared", label: "Shared with me" },
];

type Dialog =
  | { kind: "templates" }
  | { kind: "about" }
  | { kind: "rename"; d: DiagramInfo }
  | { kind: "delete"; d: DiagramInfo }
  | { kind: "share"; d: DiagramInfo };

function Thumb({ d }: { d: DiagramInfo }) {
  return d.hasThumbnail ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/diagrams/${d.id}/thumbnail?v=${d.version}`} alt="" loading="lazy" />
  ) : (
    <LayoutTemplate size={28} strokeWidth={1.25} />
  );
}

function TemplateCard({ t, onPick, busy }: { t: Template; onPick: (t: Template) => void; busy: boolean }) {
  const preview = templatePreviewUrl(t);
  return (
    <button className="tcard" disabled={busy} onClick={() => onPick(t)}>
      <span className="tpic">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" loading="lazy" />
        ) : (
          <FilePlus2 size={30} strokeWidth={1.25} />
        )}
      </span>
      <span className="tname">{t.name}</span>
    </button>
  );
}

export function Home({ me, aiEnabled }: { me: string; aiEnabled: boolean }) {
  const router = useRouter();
  const [view, setView] = useState<View>("recent");
  const [query, setQuery] = useState("");
  const [diagrams, setDiagrams] = useState<DiagramInfo[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [menu, setMenu] = useState<{ d: DiagramInfo; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ diagrams: DiagramInfo[] }>(`/api/diagrams?view=${view}&q=${encodeURIComponent(query)}`);
      setDiagrams(r.diagrams);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [view, query]);

  useEffect(() => {
    const t = setTimeout(() => void load(), query ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  const open = (id: string, extra = "") => router.push(`/d/${id}${extra}`);

  const createFrom = async (name: string, xml: string | undefined, extra = "") => {
    setBusy(true);
    setError("");
    try {
      const d = await api<DiagramInfo>("/api/diagrams", { method: "POST", json: { name, xml } });
      open(d.id, extra);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const pickTemplate = async (t: Template) => {
    setDialog(null);
    const url = templateXmlUrl(t);
    if (!url) return createFrom("Untitled diagram", undefined);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Couldn't load the ${t.name} template`);
      await createFrom(t.name, await res.text());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const importFiles = async (files: FileList | File[] | null) => {
    const list = [...(files ?? [])];
    if (!list.length) return;
    setError("");
    setBusy(true);
    try {
      if (list.length === 1) {
        const xml = await fileToXml(list[0]);
        return await createFrom(stem(list[0].name), xml);
      }
      // Several at once: bring them all in and stay on the list.
      for (const f of list) {
        const xml = await fileToXml(f).catch((e: Error) => {
          throw new Error(`${f.name}: ${e.message}`);
        });
        await api("/api/diagrams", { method: "POST", json: { name: stem(f.name), xml } });
      }
      setView("recent");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const featured = FEATURED.map((id) => TEMPLATES.find((t) => t.id === id)!);

  return (
    <div
      className={`home${dragging ? " dragging" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void importFiles(e.dataTransfer.files);
      }}
    >
      <section className="create">
        <div className="createhead">
          <h1>Diagrams</h1>
          <span className="grow" />
          <button className="btn" disabled={busy} onClick={() => fileInput.current?.click()}>
            <Upload size={16} /> Open a Visio or draw.io file
          </button>
          <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={(e) => void importFiles(e.currentTarget.files)} />
        </div>
        <div className="tgrid">
          {featured.map((t) => (
            <TemplateCard key={t.id} t={t} busy={busy} onPick={(x) => void pickTemplate(x)} />
          ))}
          {aiEnabled && (
            <button className="tcard" disabled={busy} onClick={() => void createFrom("Untitled diagram", undefined, "?ai=1")}>
              <span className="tpic accent">
                <Sparkles size={30} strokeWidth={1.25} />
              </span>
              <span className="tname">Describe it to AI</span>
            </button>
          )}
          <button className="tcard" disabled={busy} onClick={() => setDialog({ kind: "templates" })}>
            <span className="tpic">
              <LayoutTemplate size={30} strokeWidth={1.25} />
            </span>
            <span className="tname">More templates</span>
          </button>
        </div>
        <p className="error" role="alert">{error}</p>
      </section>

      <section className="files">
        <div className="filehead">
          <div className="tabs" role="tablist">
            {VIEWS.map((v) => (
              <button key={v.id} role="tab" aria-selected={view === v.id} className={view === v.id ? "on" : ""} onClick={() => setView(v.id)}>
                {v.label}
              </button>
            ))}
          </div>
          <span className="grow" />
          <label className="search">
            <Search size={15} />
            <input placeholder="Search diagrams" aria-label="Search diagrams" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
        {diagrams && !diagrams.length && (
          <div className="empty">
            <FolderOpen size={36} strokeWidth={1.25} />
            <p>
              {query
                ? "No diagrams match."
                : view === "shared"
                  ? "Nobody has shared a diagram with you yet."
                  : "No diagrams yet. Pick a template above, or drop a Visio (.vsdx) or draw.io file here."}
            </p>
          </div>
        )}
        {diagrams && diagrams.length > 0 && (
          <table className="list">
            <thead>
              <tr>
                <th colSpan={2}>Name</th>
                <th>Owner</th>
                <th>Modified</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {diagrams.map((d) => (
                <tr key={d.id} onClick={() => open(d.id)} onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ d, x: e.clientX, y: e.clientY });
                }}>
                  <td className="thumb"><Thumb d={d} /></td>
                  <td>
                    <a className="dname" href={`/d/${d.id}`} onClick={(e) => e.stopPropagation()}>{d.name}</a>
                    <span className="muted small">
                      {d.pages > 1 ? `${d.pages} pages` : "1 page"}
                      {d.members.length > 0 && (
                        <>
                          {" · "}
                          <Users size={12} /> Shared
                        </>
                      )}
                      {d.role === "view" && " · View only"}
                    </span>
                  </td>
                  <td>{person(d.owner, me)}</td>
                  <td title={`${person(d.modifiedBy, me)}`}>{when(d.modifiedAt)}</td>
                  <td className="rowact">
                    <button
                      className="iconbtn"
                      aria-label={`More for ${d.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        const r = e.currentTarget.getBoundingClientRect();
                        setMenu({ d, x: r.right - 200, y: r.bottom + 4 });
                      }}
                    >
                      <MoreHorizontal size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="about small muted">
          <button className="linkbtn" onClick={() => setDialog({ kind: "about" })}>About Synergy Diagrams</button>
        </p>
      </section>

      {menu && (
        <div className="menu ctx" style={{ left: Math.max(8, menu.x), top: menu.y }} role="menu" onClick={(e) => e.stopPropagation()}>
          <button role="menuitem" onClick={() => open(menu.d.id)}>
            <FolderOpen size={15} /> Open
          </button>
          {menu.d.role !== "view" && (
            <button role="menuitem" onClick={() => { setDialog({ kind: "rename", d: menu.d }); setMenu(null); }}>
              <Pencil size={15} /> Rename
            </button>
          )}
          <button
            role="menuitem"
            onClick={async () => {
              setMenu(null);
              await api(`/api/diagrams/${menu.d.id}/copy`, { method: "POST", json: {} }).catch((e) => setError((e as Error).message));
              await load();
            }}
          >
            <Copy size={15} /> Make a copy
          </button>
          {menu.d.role === "owner" && (
            <button role="menuitem" onClick={() => { setDialog({ kind: "share", d: menu.d }); setMenu(null); }}>
              <Share2 size={15} /> Share
            </button>
          )}
          <button role="menuitem" onClick={() => { window.location.href = `/api/diagrams/${menu.d.id}/download`; setMenu(null); }}>
            <Download size={15} /> Download (.drawio)
          </button>
          <hr />
          <button role="menuitem" onClick={() => { setDialog({ kind: "delete", d: menu.d }); setMenu(null); }}>
            <Trash2 size={15} /> {menu.d.role === "owner" ? "Delete" : "Remove from my list"}
          </button>
        </div>
      )}

      {dialog?.kind === "templates" && (
        <Modal title="New diagram" onClose={() => setDialog(null)} wide>
          <div className="form templates">
            {CATEGORIES.map((c) => (
              <div key={c}>
                <h3>{c}</h3>
                <div className="tgrid small">
                  {TEMPLATES.filter((t) => t.category === c).map((t) => (
                    <TemplateCard key={t.id} t={t} busy={busy} onPick={(x) => void pickTemplate(x)} />
                  ))}
                </div>
              </div>
            ))}
            <div className="actions">
              <span className="grow small muted">Hundreds more, with network, cloud and engineering shapes, are in the editor&apos;s own list.</span>
              <button className="btn" disabled={busy} onClick={() => { setDialog(null); void createFrom("Untitled diagram", undefined, "?templates=1"); }}>
                All templates…
              </button>
            </div>
          </div>
        </Modal>
      )}
      {dialog?.kind === "rename" && (
        <Prompt
          title="Rename"
          label="Name"
          initial={dialog.d.name}
          action="Rename"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            await api(`/api/diagrams/${dialog.d.id}`, { method: "PATCH", json: { name } });
            await load();
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <Confirm
          title={dialog.d.role === "owner" ? "Delete diagram" : "Remove from my list"}
          message={
            dialog.d.role === "owner"
              ? `“${dialog.d.name}” will be deleted for you and everyone it's shared with.`
              : `“${dialog.d.name}” stays ${person(dialog.d.owner, me)}'s; you won't see it any more.`
          }
          action={dialog.d.role === "owner" ? "Delete" : "Remove"}
          danger
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api(`/api/diagrams/${dialog.d.id}`, { method: "DELETE" }).catch((e) => setError((e as Error).message));
            await load();
          }}
        />
      )}
      {dialog?.kind === "share" && <ShareDialog diagram={dialog.d} me={me} onClose={() => setDialog(null)} onChanged={() => void load()} />}
      {dialog?.kind === "about" && (
        <Modal title="About Synergy Diagrams" onClose={() => setDialog(null)}>
          <div className="form small">
            <p>
              Synergy Diagrams is part of Synergy Suite. Its editor is{" "}
              <a href="https://github.com/jgraph/drawio" target="_blank" rel="noreferrer">draw.io</a>, open source under the{" "}
              <a href="/drawio/licenses/LICENSE-drawio" target="_blank">Apache License 2.0</a>, © draw.io Ltd and draw.io AG. It runs
              as released, with two small settings files of Synergy&apos;s. The templates are draw.io&apos;s, under{" "}
              <a href="/drawio/licenses/LICENSE-drawio-templates" target="_blank">CC BY 4.0</a>.
            </p>
            <p className="muted">
              draw.io is a trademark of draw.io Ltd. Synergy Diagrams is not affiliated with or endorsed by draw.io.
            </p>
            <div className="actions">
              <button className="btn" onClick={() => setDialog(null)}>Close</button>
            </div>
          </div>
        </Modal>
      )}
      {dragging && <div className="dropzone">Drop a Visio (.vsdx) or draw.io file to open it</div>}
    </div>
  );
}
