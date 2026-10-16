"use client";

// Review > Restrict editing: the kind of editing allowed, exceptions anyone
// may edit, form controls, and starting or stopping the protection (with an
// optional password).
import { useState } from "react";
import type { Editor } from "@tiptap/core";
import { CONTROL_LABELS, PROTECTION_LABELS, checkPassword, hashPassword, needsPassword, uncheckablePassword, parseItems, type ControlKind, type Protection, type ProtectionMode } from "@/lib/docs/protection";
import { Modal, btnCls, inputCls, Field } from "./WordDialogs";

const section = "px-4 py-3 border-b border-slate-100 space-y-2";
const h = "text-[11px] font-semibold uppercase tracking-wide text-slate-400";
const btn = "text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 disabled:opacity-40";

export function RestrictPane({
  editor,
  protection,
  canManage,
  onChange,
  onClose,
}: {
  editor: Editor;
  protection?: Protection;
  /** may change the protection (editors of the document) */
  canManage: boolean;
  onChange: (p: Protection | undefined) => void;
  onClose: () => void;
}) {
  const enforced = !!protection?.enforced;
  const [restrict, setRestrict] = useState(!!protection);
  const [mode, setMode] = useState<ProtectionMode>(protection?.edit || "readOnly");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [asking, setAsking] = useState<null | "start" | "stop">(null);
  const [error, setError] = useState("");

  const start = async () => {
    if (pw !== pw2) return setError("The passwords do not match.");
    const p: Protection = { edit: mode, enforced: true, ...(pw ? await hashPassword(pw) : {}) };
    onChange(p);
    setAsking(null);
    setPw("");
    setPw2("");
    setError("");
  };
  const stop = async () => {
    if (!protection) return;
    if (needsPassword(protection)) {
      setError("Checking…");
      // let the message paint before the hashing (Word's 100,000 rounds)
      await new Promise((r) => setTimeout(r, 30));
      if (!(await checkPassword(protection, pw))) return setError("The password is incorrect.");
    }
    onChange({ edit: protection.edit, enforced: false });
    setAsking(null);
    setPw("");
    setError("");
  };
  const insert = (kind: ControlKind) => {
    const attrs: Record<string, unknown> = {};
    if (kind === "dropdown" || kind === "comboBox") {
      const items = window.prompt("Items, separated by commas", "Choice 1, Choice 2, Choice 3");
      if (items === null) return;
      attrs.items = JSON.stringify(items.split(",").map((t) => t.trim()).filter(Boolean).map((t) => ({ text: t, value: t })));
    }
    if (kind === "date") attrs.dateFormat = "M/d/yyyy";
    editor.chain().focus().insertContentControl(kind, attrs).run();
  };
  return (
    <aside className="w-72 shrink-0 border-l border-slate-200 bg-white overflow-y-auto no-print" data-testid="restrict-pane">
      <div className="flex items-center justify-between px-4 h-11 border-b border-slate-100">
        <div className="text-sm font-semibold text-slate-700">Restrict editing</div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-sm">✕</button>
      </div>
      {enforced ? (
        <div className={section}>
          <div className="text-sm text-slate-700" data-testid="protection-status">
            This document is protected: <b>{PROTECTION_LABELS[protection!.edit]}</b>.
          </div>
          {protection!.edit === "readOnly" && <div className="text-xs text-slate-500">You can edit the highlighted regions.</div>}
          {protection!.edit === "forms" && <div className="text-xs text-slate-500">You can fill in the form controls.</div>}
          {uncheckablePassword(protection) && <div className="text-xs text-amber-700">The password was set with a hash this app can't check, so it isn't asked for.</div>}
          <button className={btn} disabled={!canManage} data-testid="protection-stop" onClick={() => (needsPassword(protection) ? setAsking("stop") : stop())}>Stop protection</button>
        </div>
      ) : (
        <>
          <div className={section}>
            <div className={h}>1. Editing restrictions</div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" aria-label="Allow only this type of editing" checked={restrict} disabled={!canManage} onChange={(e) => setRestrict(e.target.checked)} /> Allow only this type of editing
            </label>
            <select aria-label="Editing allowed" className="w-full h-8 border border-slate-300 rounded-md px-2 text-sm" disabled={!restrict || !canManage} value={mode} onChange={(e) => setMode(e.target.value as ProtectionMode)}>
              {(Object.keys(PROTECTION_LABELS) as ProtectionMode[]).map((m) => (
                <option key={m} value={m}>{PROTECTION_LABELS[m]}</option>
              ))}
            </select>
          </div>
          {restrict && mode === "readOnly" && (
            <div className={section}>
              <div className={h}>Exceptions</div>
              <div className="text-xs text-slate-500">Select parts of the document that everyone may edit.</div>
              <div className="flex gap-1">
                <button className={btn} data-testid="exception-add" onClick={() => editor.chain().focus().markEditableRange().run()}>Everyone may edit</button>
                <button className={btn} onClick={() => editor.chain().focus().clearEditableRange().run()}>Remove</button>
              </div>
            </div>
          )}
          {restrict && mode === "forms" && (
            <div className={section}>
              <div className={h}>Form controls</div>
              <div className="grid grid-cols-1 gap-1">
                {(Object.keys(CONTROL_LABELS) as ControlKind[]).map((k) => (
                  <button key={k} className={`${btn} text-left`} data-cc-insert={k} onClick={() => insert(k)}>{CONTROL_LABELS[k]}</button>
                ))}
              </div>
            </div>
          )}
          <div className={section}>
            <div className={h}>3. Start enforcement</div>
            <button className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`} disabled={!restrict || !canManage} data-testid="protection-start" onClick={() => setAsking("start")}>Yes, start enforcing protection</button>
          </div>
        </>
      )}
      {asking && (
        <Modal
          title={asking === "start" ? "Start enforcing protection" : "Unprotect document"}
          onClose={() => setAsking(null)}
          footer={
            <>
              <button className={`${btnCls} text-slate-600 hover:bg-slate-100`} onClick={() => setAsking(null)}>Cancel</button>
              <button className={`${btnCls} bg-indigo-600 text-white hover:bg-indigo-700`} data-testid="protection-ok" onClick={() => (asking === "start" ? start() : stop())}>OK</button>
            </>
          }
        >
          <div className="space-y-2">
            {asking === "start" && <div className="text-xs text-slate-500">The password is optional. Without one, anyone who can edit can stop the protection.</div>}
            <Field label="Password">
              <input type="password" aria-label="Protection password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
            {asking === "start" && (
              <Field label="Reenter password">
                <input type="password" aria-label="Reenter password" className={inputCls} value={pw2} onChange={(e) => setPw2(e.target.value)} />
              </Field>
            )}
            {error && <div className="text-xs text-red-600">{error}</div>}
          </div>
        </Modal>
      )}
    </aside>
  );
}

/** The picker for a drop-down, combo box or date control. */
export function ControlPicker({ editor, pos, onClose }: { editor: Editor; pos: number; onClose: () => void }) {
  const n = editor.state.doc.nodeAt(pos);
  const [date, setDate] = useState<string>(String(n?.attrs.date || new Date().toISOString().slice(0, 10)));
  const [other, setOther] = useState("");
  if (!n || n.type.name !== "contentControl") return null;
  const kind = n.attrs.kind as ControlKind;
  const items = parseItems(n.attrs.items);
  const pick = (text: string, attrs?: Record<string, unknown>) => {
    editor.chain().focus().setContentControlText(pos, text, attrs).run();
    onClose();
  };
  const fmtDate = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    const f = String(n.attrs.dateFormat || "M/d/yyyy");
    const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return f.replace(/yyyy|yy|MMMM|MMM|MM|M|dd|d/g, (t) => (t === "yyyy" ? String(y) : t === "yy" ? String(y).slice(2) : t === "MMMM" ? MONTHS[m - 1] : t === "MMM" ? MONTHS[m - 1].slice(0, 3) : t === "MM" ? String(m).padStart(2, "0") : t === "M" ? String(m) : t === "dd" ? String(d).padStart(2, "0") : String(d)));
  };
  return (
    <Modal title={n.attrs.title ? String(n.attrs.title) : kind === "date" ? "Pick a date" : "Choose an item"} onClose={onClose} footer={<button className={`${btnCls} text-slate-600 hover:bg-slate-100`} onClick={onClose}>Close</button>}>
      {kind === "date" ? (
        <div className="flex gap-2 items-end">
          <Field label="Date">
            <input type="date" aria-label="Control date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <button className={`${btnCls} bg-indigo-600 text-white`} data-testid="cc-date-ok" onClick={() => pick(fmtDate(date), { date })}>OK</button>
        </div>
      ) : (
        <div className="space-y-1">
          {items.map((i) => (
            <button key={i.value} data-cc-item={i.text} className="block w-full text-left px-3 py-1 text-sm rounded hover:bg-indigo-50" onClick={() => pick(i.text)}>{i.text}</button>
          ))}
          {kind === "comboBox" && (
            <div className="flex gap-2 pt-2">
              <input aria-label="Other value" className={inputCls} value={other} onChange={(e) => setOther(e.target.value)} />
              <button className={`${btnCls} bg-indigo-600 text-white`} onClick={() => other && pick(other)}>Use</button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
