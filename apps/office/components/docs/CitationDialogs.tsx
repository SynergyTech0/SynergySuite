"use client";

// Dialogs for citations: add or edit a source, manage the document's sources,
// and insert (or edit) a citation of one or more sources.
import { useState } from "react";
import { Modal, btnCls, inputCls, Field } from "./WordDialogs";
import { citationText, makeTag, SOURCE_TYPES, type CitationStyle, type Source, type SourceType } from "@/lib/docs/citations";

const FIELDS: Record<SourceType, [keyof Source, string][]> = {
  Book: [["publisher", "Publisher"], ["city", "City"]],
  JournalArticle: [["journal", "Journal name"], ["volume", "Volume"], ["issue", "Issue"], ["pages", "Pages"]],
  InternetSite: [["site", "Name of web site"], ["url", "URL"], ["accessed", "Date accessed (yyyy-mm-dd)"]],
  Report: [["publisher", "Publisher / institution"], ["city", "City"], ["url", "URL"]],
  Misc: [["publisher", "Publisher"], ["url", "URL"]],
};

function SourceForm({ value, taken, onChange }: { value: Source; taken: string[]; onChange: (s: Source) => void }) {
  const set = (k: keyof Source, v: string) => {
    const next = { ...value, [k]: v || undefined } as Source;
    // keep the tag following the author and year until someone edits it
    if ((k === "authors" || k === "year" || k === "title") && (!value.tag || value.tag === makeTag(value, taken))) next.tag = makeTag(next, taken);
    onChange(next);
  };
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Type of source">
        <select className={inputCls} value={value.type} onChange={(e) => onChange({ ...value, type: e.target.value as SourceType })} data-testid="source-type">
          {SOURCE_TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Year">
        <input className={inputCls} value={value.year || ""} onChange={(e) => set("year", e.target.value)} data-testid="source-year" />
      </Field>
      <div className="col-span-2">
        <Field label="Author(s) — Last, First; Last, First">
          <input className={inputCls} value={value.authors} onChange={(e) => set("authors", e.target.value)} data-testid="source-authors" placeholder="Smith, Jane; Doe, John" />
        </Field>
      </div>
      <div className="col-span-2">
        <Field label="Title">
          <input className={inputCls} value={value.title} onChange={(e) => set("title", e.target.value)} data-testid="source-title" />
        </Field>
      </div>
      {FIELDS[value.type].map(([k, label]) => (
        <Field key={k} label={label}>
          <input className={inputCls} value={(value[k] as string) || ""} onChange={(e) => set(k, e.target.value)} data-testid={`source-${k}`} />
        </Field>
      ))}
      <Field label="Tag name">
        <input className={inputCls} value={value.tag} onChange={(e) => onChange({ ...value, tag: e.target.value.replace(/\s+/g, "") })} data-testid="source-tag" />
      </Field>
    </div>
  );
}

const blank = (): Source => ({ tag: "", type: "Book", authors: "", title: "" });

/** Insert a citation (or edit one): tick sources, add page numbers, or add a new source on the spot. */
export function CitationDialog({ sources, style, initial, onSaveSources, onInsert, onClose }: { sources: Source[]; style: CitationStyle; initial?: { tags: string[]; pages?: string }; onSaveSources: (s: Source[]) => void; onInsert: (tags: string[], pages: string) => void; onClose: () => void }) {
  const [tags, setTags] = useState<string[]>(initial?.tags || []);
  const [pages, setPages] = useState(initial?.pages || "");
  const [draft, setDraft] = useState<Source | null>(sources.length ? null : blank());
  const taken = sources.map((s) => s.tag);
  const saveDraft = () => {
    if (!draft || !draft.title.trim()) return;
    const s = { ...draft, tag: draft.tag && !taken.includes(draft.tag) ? draft.tag : makeTag(draft, taken) };
    onSaveSources([...sources, s]);
    setTags((t) => [...t, s.tag]);
    setDraft(null);
  };
  return (
    <Modal
      title={initial ? "Edit citation" : "Insert citation"}
      onClose={onClose}
      wide
      footer={
        draft ? (
          <>
            <button onClick={() => setDraft(null)} className={`${btnCls} text-slate-600 hover:bg-slate-100 mr-auto`} disabled={!sources.length}>Back</button>
            <button onClick={saveDraft} disabled={!draft.title.trim()} className={`${btnCls} bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40`} data-testid="source-save">Add source</button>
          </>
        ) : (
          <>
            <button onClick={() => setDraft(blank())} className={`${btnCls} text-indigo-700 hover:bg-indigo-50 mr-auto`} data-testid="source-new">Add new source…</button>
            <button onClick={onClose} className={`${btnCls} text-slate-600 hover:bg-slate-100`}>Cancel</button>
            <button disabled={!tags.length} onClick={() => onInsert(tags, pages.trim())} className={`${btnCls} bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40`} data-testid="cite-insert">{initial ? "Save" : "Insert"}</button>
          </>
        )
      }
    >
      {draft ? (
        <SourceForm value={draft} taken={taken} onChange={setDraft} />
      ) : (
        <>
          <div className="border border-slate-200 rounded-md max-h-64 overflow-y-auto">
            {sources.map((s) => (
              <label key={s.tag} className="flex items-start gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer" data-testid="cite-source">
                <input type="checkbox" className="mt-1" checked={tags.includes(s.tag)} onChange={(e) => setTags((t) => (e.target.checked ? [...t, s.tag] : t.filter((x) => x !== s.tag)))} />
                <span>
                  <span className="font-medium">{s.authors || "(no author)"}</span> — {s.title} {s.year ? `(${s.year})` : ""}
                  <span className="text-[11px] text-slate-400 ml-1">{s.tag}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="Page(s) (optional)">
              <input className={inputCls} value={pages} onChange={(e) => setPages(e.target.value)} data-testid="cite-pages" placeholder="12 or 12–15" />
            </Field>
            <Field label="Preview">
              <div className="h-8 flex items-center text-sm text-slate-700" data-testid="cite-preview">{tags.length ? citationText(sources, tags, style, pages || undefined) : "—"}</div>
            </Field>
          </div>
        </>
      )}
    </Modal>
  );
}

/** Manage sources: the document's list, with edit and delete. */
export function SourcesDialog({ sources, cited, onSave, onClose }: { sources: Source[]; cited: string[]; onSave: (s: Source[]) => void; onClose: () => void }) {
  const [list, setList] = useState(sources);
  const [edit, setEdit] = useState<{ index: number; value: Source } | null>(null);
  const taken = (except: number) => list.filter((_, i) => i !== except).map((s) => s.tag);
  return (
    <Modal
      title="Source manager"
      onClose={onClose}
      wide
      footer={
        edit ? (
          <>
            <button onClick={() => setEdit(null)} className={`${btnCls} text-slate-600 hover:bg-slate-100 mr-auto`}>Back</button>
            <button
              disabled={!edit.value.title.trim()}
              onClick={() => {
                const t = taken(edit.index);
                const v = { ...edit.value, tag: edit.value.tag && !t.includes(edit.value.tag) ? edit.value.tag : makeTag(edit.value, t) };
                setList((l) => (edit.index < 0 ? [...l, v] : l.map((s, i) => (i === edit.index ? v : s))));
                setEdit(null);
              }}
              className={`${btnCls} bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40`}
              data-testid="source-save"
            >
              OK
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setEdit({ index: -1, value: blank() })} className={`${btnCls} text-indigo-700 hover:bg-indigo-50 mr-auto`} data-testid="source-new">New…</button>
            <button onClick={onClose} className={`${btnCls} text-slate-600 hover:bg-slate-100`}>Cancel</button>
            <button onClick={() => onSave(list)} className={`${btnCls} bg-indigo-600 text-white hover:bg-indigo-700`} data-testid="sources-done">Done</button>
          </>
        )
      }
    >
      {edit ? (
        <SourceForm value={edit.value} taken={taken(edit.index)} onChange={(v) => setEdit({ ...edit, value: v })} />
      ) : (
        <div className="border border-slate-200 rounded-md max-h-72 overflow-y-auto">
          {list.length === 0 && <p className="text-xs text-slate-400 p-3">No sources yet.</p>}
          {list.map((s, i) => (
            <div key={s.tag + i} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50" data-testid="source-row">
              <span className={`w-2 h-2 rounded-full ${cited.includes(s.tag) ? "bg-emerald-500" : "bg-slate-300"}`} title={cited.includes(s.tag) ? "Cited" : "Not cited"} />
              <span className="flex-1 truncate">
                <span className="font-medium">{s.authors || "(no author)"}</span> — {s.title} {s.year ? `(${s.year})` : ""}
              </span>
              <button className="text-xs text-indigo-700 hover:underline" onClick={() => setEdit({ index: i, value: s })}>Edit</button>
              <button className="text-xs text-rose-600 hover:underline" onClick={() => setList((l) => l.filter((_, k) => k !== i))}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
