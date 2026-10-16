"use client";
import {
  ArrowDown, ArrowUp, ChevronRight, Clock, Copy, Download, FolderInput, FolderPlus, FolderUp, HardDrive, Info,
  Library as LibIcon, Pencil, Plus, RotateCcw, Search, Share2, Star, Trash2, Upload, Users, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Details } from "./Details";
import { FileIcon } from "./FileIcon";
import { FolderPicker } from "./FolderPicker";
import { LibraryDialog } from "./LibraryDialog";
import { Confirm, Prompt } from "./Modal";
import { Preview } from "./Preview";
import { ShareDialog } from "./ShareDialog";
import { type Crumb, type Item, type Library, type Me, type Role, api, contentUrl, formatSize, formatWhen, openWith, person } from "./client";

type View = "files" | "recent" | "starred" | "shared" | "sharedbyme" | "trash" | "search";
type Loc = { view: View; parent?: string; library?: string; q?: string };
type Data = { items: Item[]; crumbs?: Crumb[]; role?: Role; folder?: Item | null; inShared?: boolean };
type Upload = { key: number; name: string; loaded: number; total: number; status: "queued" | "sending" | "done" | "failed"; error?: string };
type Dialog =
  | { kind: "newfolder" }
  | { kind: "rename"; item: Item }
  | { kind: "share"; item: Item }
  | { kind: "move" | "copy"; items: Item[] }
  | { kind: "newlibrary" }
  | { kind: "library"; library: Library }
  | { kind: "forever"; items: Item[] }
  | { kind: "empty" };
type Sort = { by: "name" | "modified" | "size"; desc: boolean };

const TITLES: Record<Exclude<View, "files">, string> = {
  recent: "Recent", starred: "Starred", shared: "Shared with me", sharedbyme: "Shared by me", trash: "Recycle bin", search: "Search results",
};

function locFromUrl(): Loc {
  const p = new URLSearchParams(location.search);
  const view = (p.get("view") as View) || "files";
  return { view, parent: p.get("parent") ?? undefined, library: p.get("library") ?? undefined, q: p.get("q") ?? undefined };
}

function urlFor(loc: Loc): string {
  const p = new URLSearchParams();
  if (loc.view !== "files") p.set("view", loc.view);
  if (loc.parent) p.set("parent", loc.parent);
  else if (loc.library) p.set("library", loc.library);
  if (loc.q) p.set("q", loc.q);
  const s = p.toString();
  return s ? `/?${s}` : "/";
}

/** Walks dropped folders so their files upload with their paths. */
async function droppedFiles(dt: DataTransfer): Promise<{ file: File; path: string }[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  if (!entries.length) return [...dt.files].map((f) => ({ file: f, path: f.name }));
  const out: { file: File; path: string }[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ file, path: prefix + file.name });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const e of entries) await walk(e, "");
  return out;
}

export function DriveApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [libs, setLibs] = useState<Library[]>([]);
  const [loc, setLoc] = useState<Loc | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [toast, setToast] = useState("");
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [newMenu, setNewMenu] = useState(false);
  const [sort, setSort] = useState<Sort>({ by: "name", desc: false });
  const [search, setSearch] = useState("");
  const [tick, setTick] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const uploadKey = useRef(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const say = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? "" : t)), 4000);
  }, []);

  const loadMe = useCallback(() => {
    api<Me>("/api/me").then(setMe, (e) => setError(e.message));
    api<{ libraries: Library[] }>("/api/libraries").then((r) => setLibs(r.libraries), () => {});
  }, []);

  useEffect(() => {
    loadMe();
    const start = locFromUrl();
    // A link to one file (e.g. from suite search) opens its folder with the file in preview.
    const file = new URLSearchParams(location.search).get("preview");
    if (file) {
      setPreview(file);
      setSelected(new Set([file]));
      history.replaceState(null, "", urlFor(start));
    }
    setLoc(start);
    const onPop = () => setLoc(locFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [loadMe]);

  useEffect(() => {
    if (!loc) return;
    let stale = false;
    const p = new URLSearchParams({ view: loc.view });
    if (loc.parent) p.set("parent", loc.parent);
    if (loc.library) p.set("library", loc.library);
    if (loc.q) p.set("q", loc.q);
    api<Data>(`/api/items?${p}`).then(
      (d) => {
        if (stale) return;
        setData(d);
        setError("");
        setSelected((s) => new Set([...s].filter((id) => d.items.some((i) => i.id === id))));
      },
      (e) => !stale && (setError(e.message), setData({ items: [] })),
    );
    return () => {
      stale = true;
    };
  }, [loc, tick]);

  const go = useCallback((next: Loc) => {
    history.pushState(null, "", urlFor(next));
    setLoc(next);
    setData(null);
    setSelected(new Set());
    setPreview(null);
    setMenu(null);
    if (next.view !== "search") setSearch("");
  }, []);

  const items = useMemo(() => {
    const list = [...(data?.items ?? [])];
    const dir = sort.desc ? -1 : 1;
    list.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      if (sort.by === "modified") return dir * (Date.parse(a.modifiedAt) - Date.parse(b.modifiedAt));
      if (sort.by === "size") return dir * (a.size - b.size);
      return dir * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    });
    if (loc?.view === "recent" && sort.by === "name" && !sort.desc) list.sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
    return list;
  }, [data, sort, loc?.view]);

  const chosen = items.filter((i) => selected.has(i.id));
  const one = chosen.length === 1 ? chosen[0] : null;
  const inTrash = loc?.view === "trash";
  const inFolder = loc?.view === "files";
  const canAdd = inFolder && data?.role !== undefined && data.role !== "viewer";
  const files = items.filter((i) => i.kind === "file");

  /* uploads */

  const uploadTarget = useCallback((): string => {
    const p = new URLSearchParams();
    if (loc?.view === "files" && loc.parent) p.set("parent", loc.parent);
    else if (loc?.view === "files" && loc.library) p.set("library", loc.library);
    return p.toString();
  }, [loc]);

  const startUploads = useCallback(
    (list: { file: File; path: string }[]) => {
      if (!list.length) return;
      if (!canAdd && loc?.view === "files") return say("You can only view this folder");
      const target = uploadTarget();
      const jobs = list.map((f) => ({ ...f, key: ++uploadKey.current }));
      setUploads((u) => [
        ...u.filter((x) => x.status !== "done"),
        ...jobs.map((j) => ({ key: j.key, name: j.path, loaded: 0, total: j.file.size, status: "queued" as const })),
      ]);
      const patch = (key: number, p: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...p } : x)));
      const send = (j: (typeof jobs)[number]) =>
        new Promise<void>((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", `/api/upload?${target}${target ? "&" : ""}path=${encodeURIComponent(j.path)}`);
          xhr.upload.onprogress = (e) => patch(j.key, { loaded: e.loaded, status: "sending" });
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) patch(j.key, { status: "done", loaded: j.file.size });
            else {
              let msg = `Upload failed (${xhr.status})`;
              try {
                msg = JSON.parse(xhr.responseText).error || msg;
              } catch {}
              patch(j.key, { status: "failed", error: msg });
            }
            resolve();
          };
          xhr.onerror = () => {
            patch(j.key, { status: "failed", error: "Connection lost" });
            resolve();
          };
          patch(j.key, { status: "sending" });
          xhr.send(j.file);
        });
      const queue = [...jobs];
      const worker = async () => {
        while (queue.length) {
          await send(queue.shift()!);
          refresh();
        }
      };
      void Promise.all([worker(), worker(), worker()]).then(() => {
        refresh();
        loadMe();
      });
    },
    [canAdd, loc?.view, uploadTarget, refresh, loadMe, say],
  );

  /* actions */

  const act = useCallback(
    async (action: string, list: Item[], target?: { parent?: string; library?: string }, done?: string) => {
      try {
        await api("/api/actions", { method: "POST", json: { action, ids: list.map((i) => i.id), target } });
        if (done) say(done);
        setSelected(new Set());
        refresh();
        loadMe();
      } catch (e) {
        say((e as Error).message);
        throw e;
      }
    },
    [refresh, loadMe, say],
  );

  const open = useCallback(
    (item: Item) => {
      if (inTrash) return;
      if (item.kind === "folder") go({ view: "files", parent: item.id });
      else setPreview(item.id);
    },
    [inTrash, go],
  );

  const download = (list: Item[]) => {
    list.forEach((it, i) =>
      window.setTimeout(() => {
        const a = document.createElement("a");
        a.href = contentUrl(it.id);
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 400),
    );
  };

  const toggleStar = async (list: Item[]) => {
    const on = !list.every((i) => i.starred);
    try {
      for (const i of list) await api(`/api/items/${i.id}`, { method: "PATCH", json: { starred: on } });
      refresh();
    } catch (e) {
      say((e as Error).message);
    }
  };

  const select = (item: Item, e: React.MouseEvent) => {
    setMenu(null);
    if (e.shiftKey && anchor) {
      const ids = items.map((i) => i.id);
      const [a, b] = [ids.indexOf(anchor), ids.indexOf(item.id)].sort((x, y) => x - y);
      setSelected(new Set(ids.slice(a, b + 1)));
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(item.id)) n.delete(item.id);
        else n.add(item.id);
        return n;
      });
    } else setSelected(new Set([item.id]));
    setAnchor(item.id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog || preview || (e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === "Escape") setSelected(new Set());
      else if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        setSelected(new Set(items.map((i) => i.id)));
      } else if (e.key === "Delete" && chosen.length && !inTrash) void act("trash", chosen, undefined, `Moved ${chosen.length} to the recycle bin`).catch(() => {});
      else if (e.key === "F2" && one && !inTrash) setDialog({ kind: "rename", item: one });
      else if (e.key === "Enter" && one) open(one);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, preview, items, chosen, one, inTrash, act, open]);

  /* render */

  if (!loc) return null;
  const crumbs = loc.view === "files" ? data?.crumbs ?? [] : [{ label: TITLES[loc.view] }];
  const previewItem = preview ? files.find((f) => f.id === preview) : null;
  const pi = previewItem ? files.indexOf(previewItem) : -1;
  const sortBy = (by: Sort["by"]) => setSort((s) => ({ by, desc: s.by === by ? !s.desc : by !== "name" }));
  const arrow = (by: Sort["by"]) => (sort.by === by ? sort.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} /> : null);
  const navOn = (v: View, lib?: string) => {
    if (lib) return loc.view === "files" && data?.crumbs?.[0]?.library === lib;
    if (v === "files") return loc.view === "files" && !!data?.crumbs?.length && data.crumbs[0].view === "files";
    if (v === "shared") return loc.view === "shared" || loc.view === "sharedbyme" || (loc.view === "files" && data?.crumbs?.[0]?.view === "shared");
    return loc.view === v;
  };
  const used = me ? (me.quota ? Math.min(100, (me.used / me.quota) * 100) : 0) : 0;

  return (
    <div className={`drive${details ? " withdetails" : ""}`}>
      <nav className="nav" aria-label="Drive">
        <div className="newwrap">
          <button className="btn primary newbtn" onClick={() => setNewMenu((m) => !m)} aria-haspopup="menu" aria-expanded={newMenu}>
            <Plus size={18} /> New
          </button>
          {newMenu && (
            <div className="menu newmenu" role="menu" onMouseLeave={() => setNewMenu(false)}>
              <button role="menuitem" disabled={!canAdd && inFolder} onClick={() => (setNewMenu(false), inFolder ? setDialog({ kind: "newfolder" }) : (go({ view: "files" }), setDialog({ kind: "newfolder" })))}>
                <FolderPlus size={16} /> Folder
              </button>
              <button role="menuitem" disabled={!canAdd && inFolder} onClick={() => (setNewMenu(false), fileInput.current?.click())}>
                <Upload size={16} /> Upload files
              </button>
              <button role="menuitem" disabled={!canAdd && inFolder} onClick={() => (setNewMenu(false), folderInput.current?.click())}>
                <FolderUp size={16} /> Upload folder
              </button>
              <hr />
              <button role="menuitem" onClick={() => (setNewMenu(false), setDialog({ kind: "newlibrary" }))}>
                <LibIcon size={16} /> Shared library
              </button>
            </div>
          )}
        </div>
        <button className={`navitem${navOn("files") ? " active" : ""}`} onClick={() => go({ view: "files" })}>
          <HardDrive size={18} /> My files
        </button>
        <button className={`navitem${navOn("recent") ? " active" : ""}`} onClick={() => go({ view: "recent" })}>
          <Clock size={18} /> Recent
        </button>
        <button className={`navitem${navOn("starred") ? " active" : ""}`} onClick={() => go({ view: "starred" })}>
          <Star size={18} /> Starred
        </button>
        <button className={`navitem${navOn("shared") ? " active" : ""}`} onClick={() => go({ view: "shared" })}>
          <Users size={18} /> Shared
        </button>
        <button className={`navitem${navOn("trash") ? " active" : ""}`} onClick={() => go({ view: "trash" })}>
          <Trash2 size={18} /> Recycle bin
        </button>
        <div className="navsection">
          <span>Libraries</span>
          <button className="iconbtn small" title="New shared library" aria-label="New shared library" onClick={() => setDialog({ kind: "newlibrary" })}>
            <Plus size={14} />
          </button>
        </div>
        {libs.map((l) => (
          <button key={l.id} className={`navitem${navOn("files", l.id) ? " active" : ""}`} onClick={() => go({ view: "files", library: l.id })}>
            <LibIcon size={18} /> <span className="fname">{l.name}</span>
          </button>
        ))}
        {!libs.length && <p className="muted small navhint">Shared libraries hold a team&apos;s files.</p>}
        <div className="grow" />
        {me && (
          <div className="storage" aria-label="Storage">
            {me.quota ? <div className="meter"><div style={{ width: `${used}%` }} className={used > 90 ? "full" : ""} /></div> : null}
            <span className="muted small">
              {formatSize(me.used)} used{me.quota ? ` of ${formatSize(me.quota)}` : ""}
            </span>
          </div>
        )}
      </nav>

      <main
        className={`main${dragging ? " dragging" : ""}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files") || !canAdd) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
        onDrop={async (e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(false);
          startUploads(await droppedFiles(e.dataTransfer));
        }}
        onClick={() => (setMenu(null), setNewMenu(false))}
      >
        <div className="topbar">
          <form
            className="search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (search.trim()) go({ view: "search", q: search.trim() });
            }}
          >
            <Search size={16} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search files and folders" aria-label="Search" />
            {search && (
              <button type="button" className="iconbtn small" aria-label="Clear search" onClick={() => (setSearch(""), loc.view === "search" && go({ view: "files" }))}>
                <X size={14} />
              </button>
            )}
          </form>
        </div>

        <div className="commands" role="toolbar" aria-label="Commands">
          {inTrash ? (
            <>
              <button className="btn ghost" disabled={!chosen.length} onClick={() => void act("restore", chosen, undefined, "Restored").catch(() => {})}>
                <RotateCcw size={16} /> Restore
              </button>
              <button className="btn ghost" disabled={!chosen.length} onClick={() => setDialog({ kind: "forever", items: chosen })}>
                <Trash2 size={16} /> Delete forever
              </button>
              <button className="btn ghost" disabled={!items.length} onClick={() => setDialog({ kind: "empty" })}>
                Empty recycle bin
              </button>
              <span className="grow" />
            </>
          ) : chosen.length ? (
            <>
              {one && (
                <button className="btn ghost" onClick={() => setDialog({ kind: "share", item: one })}>
                  <Share2 size={16} /> Share
                </button>
              )}
              <button className="btn ghost" onClick={() => download(chosen)}>
                <Download size={16} /> Download
              </button>
              <button className="btn ghost" onClick={() => setDialog({ kind: "move", items: chosen })}>
                <FolderInput size={16} /> Move to
              </button>
              <button className="btn ghost" onClick={() => setDialog({ kind: "copy", items: chosen })}>
                <Copy size={16} /> Copy to
              </button>
              {one && (
                <button className="btn ghost" onClick={() => setDialog({ kind: "rename", item: one })}>
                  <Pencil size={16} /> Rename
                </button>
              )}
              <button className="btn ghost" onClick={() => void toggleStar(chosen)}>
                <Star size={16} /> {chosen.every((i) => i.starred) ? "Unstar" : "Star"}
              </button>
              <button className="btn ghost" onClick={() => void act("trash", chosen, undefined, `Moved ${chosen.length} to the recycle bin`).catch(() => {})}>
                <Trash2 size={16} /> Delete
              </button>
              <span className="grow" />
              <span className="muted small">{chosen.length} selected</span>
              <button className="iconbtn" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
                <X size={16} />
              </button>
            </>
          ) : (
            <>
              <button className="btn ghost" disabled={!canAdd} onClick={() => setDialog({ kind: "newfolder" })}>
                <FolderPlus size={16} /> New folder
              </button>
              <button className="btn ghost" disabled={!canAdd} onClick={() => fileInput.current?.click()}>
                <Upload size={16} /> Upload
              </button>
              {loc.library && !loc.parent && (
                <button className="btn ghost" onClick={() => { const l = libs.find((x) => x.id === loc.library); if (l) setDialog({ kind: "library", library: l }); }}>
                  <Users size={16} /> Members
                </button>
              )}
              {loc.view === "files" && loc.parent && data?.folder && (
                <button className="btn ghost" onClick={() => setDialog({ kind: "share", item: data.folder! })}>
                  <Share2 size={16} /> Share folder
                </button>
              )}
              <span className="grow" />
            </>
          )}
          <button className={`iconbtn${details ? " on" : ""}`} title="Details" aria-label="Details" aria-pressed={details} onClick={() => setDetails((d) => !d)}>
            <Info size={18} />
          </button>
        </div>

        {(loc.view === "shared" || loc.view === "sharedbyme") && (
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={loc.view === "shared"} className={loc.view === "shared" ? "on" : ""} onClick={() => go({ view: "shared" })}>With me</button>
            <button role="tab" aria-selected={loc.view === "sharedbyme"} className={loc.view === "sharedbyme" ? "on" : ""} onClick={() => go({ view: "sharedbyme" })}>By me</button>
          </div>
        )}

        <nav className="crumbs" aria-label="Folder path">
          {crumbs.map((c, i) => (
            <span key={i} className="crumb">
              {i > 0 && <ChevronRight size={16} className="muted" />}
              {i === crumbs.length - 1 ? (
                <h1>{loc.view === "search" ? `Results for "${loc.q}"` : c.label}</h1>
              ) : (
                <button className="linkbtn" onClick={() => go(c.parent ? { view: "files", parent: c.parent } : c.library ? { view: "files", library: c.library } : { view: (c.view as View) || "files" })}>
                  {c.label}
                </button>
              )}
            </span>
          ))}
        </nav>

        {error && <p className="error pad" role="alert">{error}</p>}

        <div className="tablewrap" onContextMenu={(e) => e.target === e.currentTarget && e.preventDefault()}>
          <table className="files">
            <thead>
              <tr>
                <th className="check">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={!!items.length && chosen.length === items.length}
                    onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
                  />
                </th>
                <th><button className="th" onClick={() => sortBy("name")}>Name {arrow("name")}</button></th>
                <th className="wide"><button className="th" onClick={() => sortBy("modified")}>{inTrash ? "Deleted" : "Modified"} {arrow("modified")}</button></th>
                <th className="wide">{inTrash ? "Deleted by" : loc.view === "files" ? "Modified by" : "Location"}</th>
                <th className="num"><button className="th" onClick={() => sortBy("size")}>Size {arrow("size")}</button></th>
                <th className="wide">Sharing</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr
                  key={it.id}
                  className={selected.has(it.id) ? "sel" : ""}
                  onClick={(e) => (e.stopPropagation(), select(it, e))}
                  onDoubleClick={() => open(it)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!selected.has(it.id)) setSelected(new Set([it.id]));
                    setMenu({ x: e.clientX, y: e.clientY });
                  }}
                  aria-selected={selected.has(it.id)}
                >
                  <td className="check">
                    <input
                      type="checkbox"
                      aria-label={`Select ${it.name}`}
                      checked={selected.has(it.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (n.has(it.id)) n.delete(it.id);
                          else n.add(it.id);
                          return n;
                        })
                      }
                    />
                  </td>
                  <td>
                    <span className="namecell">
                      <FileIcon kind={it.kind} name={it.name} />
                      <button className="namebtn" onClick={(e) => (e.stopPropagation(), open(it))} disabled={inTrash}>
                        {it.name}
                      </button>
                      {it.starred && <Star size={13} className="starred" fill="currentColor" aria-label="Starred" />}
                    </span>
                  </td>
                  <td className="wide muted">{formatWhen(inTrash && it.trashedAt ? it.trashedAt : it.modifiedAt)}</td>
                  <td className="wide muted">{inTrash ? person(it.trashedBy ?? "", me?.email ?? "") : loc.view === "files" ? person(it.modifiedBy, me?.email ?? "") : it.location === "My files" || !it.location?.includes("@") ? it.location : person(it.location, me?.email ?? "")}</td>
                  <td className="num muted">{it.kind === "file" ? formatSize(it.size) : ""}</td>
                  <td className="wide muted">
                    {it.shared || data?.inShared || (it.owner && it.owner !== me?.email) ? (
                      <span className="sharedtag"><Users size={13} /> Shared</span>
                    ) : it.libraryId ? "Library" : "Private"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !items.length && !error && (
            <div className="empty">
              {loc.view === "files" ? (
                <>
                  <FolderUp size={48} strokeWidth={1.2} />
                  <p>{canAdd ? "Drop files here, or use Upload" : "This folder is empty"}</p>
                </>
              ) : (
                <p>
                  {{
                    recent: "Files you open or change show up here.",
                    starred: "Star files and folders to find them quickly.",
                    shared: "Nothing has been shared with you yet.",
                    sharedbyme: "You haven't shared anything yet.",
                    trash: "The recycle bin is empty. Deleted items stay here for a while before they go for good.",
                    search: "Nothing matches that search.",
                  }[loc.view]}
                </p>
              )}
            </div>
          )}
          {!data && <p className="muted pad">Loading…</p>}
          {dragging && <div className="dropzone">Drop to upload here</div>}
        </div>
      </main>

      {details && (one ?? data?.folder) && (
        <Details
          key={(one ?? data?.folder)!.id}
          id={(one ?? data?.folder)!.id}
          me={me?.email ?? ""}
          ai={!!me?.ai}
          onClose={() => setDetails(false)}
          onChanged={refresh}
          onShare={() => {
            const it = one ?? data?.folder;
            if (it) setDialog({ kind: "share", item: it });
          }}
        />
      )}
      {details && !one && !data?.folder && (
        <aside className="details"><p className="muted pad">Select a file or folder to see its details.</p></aside>
      )}

      {menu && chosen.length > 0 && (
        <div className="menu ctx" role="menu" style={{ left: menu.x, top: menu.y }} onClick={() => setMenu(null)}>
          {inTrash ? (
            <>
              <button role="menuitem" onClick={() => void act("restore", chosen, undefined, "Restored").catch(() => {})}><RotateCcw size={16} /> Restore</button>
              <button role="menuitem" onClick={() => setDialog({ kind: "forever", items: chosen })}><Trash2 size={16} /> Delete forever</button>
            </>
          ) : (
            <>
              {one && <button role="menuitem" onClick={() => open(one)}>Open</button>}
              {one && <button role="menuitem" onClick={() => setDialog({ kind: "share", item: one })}><Share2 size={16} /> Share</button>}
              <button role="menuitem" onClick={() => download(chosen)}><Download size={16} /> Download</button>
              <hr />
              {one && <button role="menuitem" onClick={() => setDialog({ kind: "rename", item: one })}><Pencil size={16} /> Rename</button>}
              <button role="menuitem" onClick={() => setDialog({ kind: "move", items: chosen })}><FolderInput size={16} /> Move to</button>
              <button role="menuitem" onClick={() => setDialog({ kind: "copy", items: chosen })}><Copy size={16} /> Copy to</button>
              <button role="menuitem" onClick={() => void toggleStar(chosen)}><Star size={16} /> {chosen.every((i) => i.starred) ? "Unstar" : "Star"}</button>
              <button role="menuitem" onClick={() => setDetails(true)}><Info size={16} /> Details</button>
              <hr />
              <button role="menuitem" onClick={() => void act("trash", chosen, undefined, `Moved ${chosen.length} to the recycle bin`).catch(() => {})}><Trash2 size={16} /> Delete</button>
            </>
          )}
        </div>
      )}

      <input ref={fileInput} type="file" multiple hidden onChange={(e) => (startUploads([...(e.target.files ?? [])].map((f) => ({ file: f, path: f.name }))), (e.target.value = ""))} />
      <input
        ref={folderInput}
        type="file"
        hidden
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={(e) => (startUploads([...(e.target.files ?? [])].map((f) => ({ file: f, path: f.webkitRelativePath || f.name }))), (e.target.value = ""))}
      />

      {uploads.length > 0 && (
        <div className="uploads" aria-live="polite">
          <div className="uploadshead">
            <b>
              {uploads.some((u) => u.status === "queued" || u.status === "sending")
                ? `Uploading ${uploads.filter((u) => u.status !== "done" && u.status !== "failed").length}`
                : `${uploads.filter((u) => u.status === "done").length} uploaded${uploads.some((u) => u.status === "failed") ? `, ${uploads.filter((u) => u.status === "failed").length} failed` : ""}`}
            </b>
            <button className="iconbtn small dark" aria-label="Close uploads" onClick={() => setUploads((u) => u.filter((x) => x.status === "queued" || x.status === "sending"))}>
              <X size={14} />
            </button>
          </div>
          <ul>
            {uploads.slice(-50).map((u) => (
              <li key={u.key} className={u.status}>
                <span className="fname" title={u.name}>{u.name}</span>
                {u.status === "failed" ? (
                  <span className="error small" title={u.error}>{u.error}</span>
                ) : u.status === "done" ? (
                  <span className="ok small">Done</span>
                ) : (
                  <span className="bar"><span style={{ width: `${u.total ? (u.loaded / u.total) * 100 : 0}%` }} /></span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}

      {previewItem && (
        <Preview
          item={previewItem}
          src={contentUrl(previewItem.id, { inline: true })}
          download={contentUrl(previewItem.id)}
          onClose={() => setPreview(null)}
          onPrev={pi > 0 ? () => setPreview(files[pi - 1].id) : undefined}
          onNext={pi < files.length - 1 ? () => setPreview(files[pi + 1].id) : undefined}
          onShare={() => setDialog({ kind: "share", item: previewItem })}
          openWith={openWith(previewItem)}
        />
      )}

      {dialog?.kind === "newfolder" && (
        <Prompt
          title="New folder"
          label="Name"
          initial="New folder"
          action="Create"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            await api("/api/items", { method: "POST", json: { name, parent: loc.parent, library: loc.library } });
            refresh();
          }}
        />
      )}
      {dialog?.kind === "rename" && (
        <Prompt
          title="Rename"
          label="Name"
          initial={dialog.item.name}
          action="Rename"
          selectStem={dialog.item.kind === "file"}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            await api(`/api/items/${dialog.item.id}`, { method: "PATCH", json: { name } });
            refresh();
          }}
        />
      )}
      {dialog?.kind === "share" && <ShareDialog item={dialog.item} me={me?.email ?? ""} onClose={() => setDialog(null)} onChanged={refresh} />}
      {(dialog?.kind === "move" || dialog?.kind === "copy") && (
        <FolderPicker
          title={`${dialog.kind === "move" ? "Move" : "Copy"} ${dialog.items.length === 1 ? `"${dialog.items[0].name}"` : `${dialog.items.length} items`}`}
          action={dialog.kind === "move" ? "Move" : "Copy"}
          libraries={libs}
          moving={dialog.kind === "move" ? dialog.items : []}
          onClose={() => setDialog(null)}
          onPick={(target) => act(dialog.kind, dialog.items, target, dialog.kind === "move" ? "Moved" : "Copied")}
        />
      )}
      {dialog?.kind === "newlibrary" && (
        <Prompt
          title="New shared library"
          label="Library name"
          action="Create"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const lib = await api<Library>("/api/libraries", { method: "POST", json: { name } });
            loadMe();
            go({ view: "files", library: lib.id });
          }}
        />
      )}
      {dialog?.kind === "library" && (
        <LibraryDialog
          library={dialog.library}
          me={me?.email ?? ""}
          onClose={() => setDialog(null)}
          onChanged={loadMe}
          onDeleted={() => (setDialog(null), loadMe(), go({ view: "files" }))}
        />
      )}
      {dialog?.kind === "forever" && (
        <Confirm
          title="Delete forever?"
          message={`${dialog.items.length === 1 ? `"${dialog.items[0].name}"` : `These ${dialog.items.length} items`} will be deleted for good, with all versions. This can't be undone.`}
          action="Delete forever"
          danger
          onClose={() => setDialog(null)}
          onConfirm={() => act("forever", dialog.items, undefined, "Deleted").catch(() => {})}
        />
      )}
      {dialog?.kind === "empty" && (
        <Confirm
          title="Empty the recycle bin?"
          message="Everything in the recycle bin will be deleted for good. This can't be undone."
          action="Empty recycle bin"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            try {
              await api("/api/trash", { method: "DELETE" });
              say("Recycle bin emptied");
              refresh();
              loadMe();
            } catch (e) {
              say((e as Error).message);
            }
          }}
        />
      )}
    </div>
  );
}
