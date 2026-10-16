"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { setPendingImport } from "@/lib/slides/pending-import";
import NotificationBell from "./NotificationBell";

export type Kind = "doc" | "sheet" | "slide";
export type Scope = "private" | "company";
export type Doc = {
  id: string;
  kind: Kind;
  title: string;
  snippet: string;
  owner_email: string;
  scope: Scope;
  shared: boolean; // shared with me personally (a grant exists)
  updated_at: string;
};

function ago(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

const KINDS: Record<Kind, { href: (id: string) => string; label: string; icon: string; ring: string; chip: string }> = {
  doc: { href: (id) => `/doc/${id}`, label: "Document", icon: "📄", ring: "hover:border-indigo-400", chip: "bg-indigo-50 text-indigo-700" },
  sheet: { href: (id) => `/sheet/${id}`, label: "Spreadsheet", icon: "▦", ring: "hover:border-emerald-400", chip: "bg-emerald-50 text-emerald-700" },
  slide: { href: (id) => `/slides/${id}`, label: "Presentation", icon: "▭", ring: "hover:border-amber-400", chip: "bg-amber-50 text-amber-700" },
};

const NEW_ITEMS: { kind: Kind; label: string }[] = [
  { kind: "doc", label: "Document" },
  { kind: "sheet", label: "Spreadsheet" },
  { kind: "slide", label: "Presentation" },
];

export default function DocList({ docs, me }: { docs: Doc[]; me: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"mine" | "shared" | "company">("mine");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const create = async (kind: Kind) => {
    setBusy(true);
    setOpen(false);
    const res = await fetch("/api/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Creating from the Company tab shares it straight away.
      body: JSON.stringify({ kind, scope: tab === "company" ? "company" : "private" }),
    });
    const { id } = await res.json();
    router.push(KINDS[kind].href(id));
  };

  // Open an existing PowerPoint file: create a presentation and import into it.
  const pptxInput = useRef<HTMLInputElement>(null);
  const uploadPptx = async (file: File) => {
    setBusy(true);
    const res = await fetch("/api/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "slide", scope: tab === "company" ? "company" : "private" }),
    });
    const { id } = await res.json();
    setPendingImport(id, file);
    router.push(KINDS.slide.href(id));
  };

  // Open an existing Word file: create a document and import into it.
  const docxInput = useRef<HTMLInputElement>(null);
  const uploadDocx = async (file: File) => {
    setBusy(true);
    const res = await fetch("/api/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "doc", scope: tab === "company" ? "company" : "private", title: /\.(dotx|dotm|dot)$/i.test(file.name) ? "" : file.name.replace(/\.(docx|docm|odt|rtf|doc|txt|md|markdown)$/i, "").slice(0, 200) }),
    });
    const { id } = await res.json();
    setPendingImport(id, file);
    router.push(KINDS.doc.href(id));
  };

  const remove = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this? This cannot be undone.")) return;
    await fetch(`/api/docs/${id}`, { method: "DELETE" });
    router.refresh();
  };

  const setCompany = async (id: string, on: boolean, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await fetch(`/api/docs/${id}/share`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyRole: on ? "editor" : "none" }),
    });
    router.refresh();
  };

  const mine = docs.filter((d) => d.owner_email === me);
  const shared = docs.filter((d) => d.shared && d.owner_email !== me);
  const company = docs.filter((d) => d.scope === "company");
  const shown = tab === "mine" ? mine : tab === "shared" ? shared : company;

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">SynergyDocs</h1>
          <p className="text-sm text-slate-500">Signed in as {me}</p>
        </div>
        <div className="flex items-center gap-2">
        <NotificationBell />
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setOpen((o) => !o)}
            disabled={busy}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg px-4 py-2.5 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {busy ? "Creating…" : "+ New"}
            <span className="text-white/70 text-[10px]">▼</span>
          </button>
          {open && (
            <div className="absolute right-0 mt-1 w-56 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-10">
              <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-slate-400">
                New in {tab === "company" ? "Company folder" : "My documents"}
              </div>
              {NEW_ITEMS.map((it) => (
                <button key={it.kind} onClick={() => create(it.kind)} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-3">
                  <span className="w-6 text-center text-slate-400">{KINDS[it.kind].icon}</span>
                  {it.label}
                </button>
              ))}
              <div className="border-t border-slate-100 my-1" />
              <button onClick={() => { setOpen(false); pptxInput.current?.click(); }} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-3">
                <span className="w-6 text-center text-slate-400">⇪</span>
                Open presentation file…
              </button>
              <button onClick={() => { setOpen(false); docxInput.current?.click(); }} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-3">
                <span className="w-6 text-center text-slate-400">⇪</span>
                Open document (Word, text, Markdown)…
              </button>
              <button onClick={() => { setOpen(false); docxInput.current?.click(); }} data-testid="doclist-new-from-template" className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-3">
                <span className="w-6 text-center text-slate-400">⧉</span>
                New from Word template (.dotx)…
              </button>
            </div>
          )}
          <input ref={docxInput} type="file" accept=".docx,.dotx,.docm,.dotm,.odt,.rtf,.doc,.dot,.txt,.md,.markdown" className="hidden" data-testid="doclist-docx" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDocx(f); e.target.value = ""; }} />
          <input ref={pptxInput} type="file" accept=".pptx,.odp,.ppt" className="hidden" data-testid="doclist-pptx" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPptx(f); e.target.value = ""; }} />
        </div>
        </div>
      </div>

      {/* tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 mb-6">
        {(
          [
            ["mine", "My documents", mine.length],
            ["shared", "Shared with me", shared.length],
            ["company", "🏢 Company folder", company.length],
          ] as const
        ).map(([key, label, n]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === key ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
          >
            {label} <span className="text-slate-400">{n}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="border border-dashed border-slate-300 rounded-2xl bg-white py-16 text-center">
          <p className="text-slate-500">{tab === "company" ? "Nothing shared with your company yet." : "Nothing here yet."}</p>
          <button onClick={() => create("doc")} className="mt-3 text-indigo-600 font-medium hover:underline">
            Create {tab === "company" ? "a shared document" : "your first document"}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {shown.map((d) => {
            const k = KINDS[d.kind] ?? KINDS.doc;
            const owned = d.owner_email === me;
            return (
              <a key={d.id} href={k.href(d.id)} className={`group bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-sm transition flex flex-col min-h-[150px] ${k.ring}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${k.chip}`}>{k.label}</span>
                  {d.scope === "company" && <span className="text-[11px] font-medium rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700">🏢 Company</span>}
                </div>
                <h3 className="font-semibold text-slate-900 line-clamp-2">{d.title || "Untitled"}</h3>
                <p className="text-[13px] text-slate-500 mt-1 line-clamp-2 flex-1">{d.snippet || "Empty"}</p>
                <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                  <span>{owned ? `Edited ${ago(d.updated_at)}` : `${d.owner_email.split("@")[0]} · ${ago(d.updated_at)}`}</span>
                  {owned && (
                    <span className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition">
                      {d.scope === "company" ? (
                        <button onClick={(e) => setCompany(d.id, false, e)} className="text-slate-400 hover:text-slate-700" title="Remove company access">Unshare</button>
                      ) : (
                        <button onClick={(e) => setCompany(d.id, true, e)} className="text-slate-400 hover:text-emerald-600" title="Share with company">Share</button>
                      )}
                      <button onClick={(e) => remove(d.id, e)} className="text-slate-400 hover:text-red-500">Delete</button>
                    </span>
                  )}
                </div>
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}
