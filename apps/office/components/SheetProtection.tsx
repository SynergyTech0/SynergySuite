"use client";

// Protected sheets and ranges: the list for everyone, and the editor for the
// owner. Who may change a protected area is the owner plus the people listed.
import { useEffect, useState } from "react";
import { canEditProtection, parseRect, rectText, sheetPassword, type Actor, type Protection, type Rect } from "@/lib/sheet-protection";
import { hashPassword, hasPassword, withoutPassword } from "@/lib/excel-password";

type Sheet = { id: string; name: string };
type Draft = { id: string; sheetId: string; whole: boolean; range: string; except: string; description: string; editors: string[]; extra: string; password: string; rangePassword: string; noPassword: boolean };

const input = "w-full rounded border border-slate-300 px-2 py-1 text-xs";
const btn = "rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40";

function toDraft(p: Protection): Draft {
  return {
    id: p.id,
    sheetId: p.sheetId,
    whole: !p.range,
    range: p.range ? rectText(p.range) : "",
    except: (p.except || []).map(rectText).join(", "),
    description: p.description || "",
    editors: (p.editors || []).filter((e) => e !== "*"),
    extra: "",
    password: "",
    rangePassword: "",
    noPassword: false,
  };
}

export default function SheetProtection({
  protections,
  sheets,
  activeSheetId,
  selection,
  actor,
  isOwner,
  docId,
  startNew,
  onSave,
  onSelect,
  onClose,
}: {
  protections: Protection[];
  sheets: Sheet[];
  activeSheetId: string | undefined;
  selection: () => Rect | null;
  actor: Actor;
  isOwner: boolean;
  docId?: string;
  /** Open straight into a new protection: "range" or "sheet". */
  startNew?: { kind: "range" | "sheet"; n: number } | null;
  onSave: (list: Protection[]) => Promise<void>;
  onSelect: (p: Protection) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [people, setPeople] = useState<string[]>([]);
  const sheetName = (id: string) => sheets.find((s) => s.id === id)?.name || "(deleted sheet)";

  // Editors of the document are the people a protection can let through.
  useEffect(() => {
    if (!isOwner || !docId) return;
    fetch(`/api/docs/${docId}/share`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPeople(((d?.grants || []) as { email: string; role: string }[]).filter((g) => g.role === "editor").map((g) => g.email)))
      .catch(() => {});
  }, [isOwner, docId]);

  const fresh = (kind: "range" | "sheet") => {
    const sel = selection();
    setError("");
    setDraft({
      id: crypto.randomUUID(),
      sheetId: activeSheetId || sheets[0]?.id || "",
      whole: kind === "sheet",
      range: kind === "range" && sel ? rectText(sel) : "",
      except: "",
      description: "",
      editors: [],
      extra: "",
      password: "",
      rangePassword: "",
      noPassword: false,
    });
  };
  useEffect(() => {
    if (startNew && isOwner) fresh(startNew.kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startNew?.n]);

  const submit = async () => {
    if (!draft) return;
    const range = draft.whole ? null : parseRect(draft.range);
    if (!draft.whole && !range) return setError("Enter a range such as B2:D10.");
    const except: Rect[] = [];
    for (const part of draft.except.split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
      const r = parseRect(part);
      if (!r) return setError(`"${part}" is not a range.`);
      except.push(r);
    }
    const extra = draft.extra.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (extra.some((e) => !/^[^@\s]+@[^@\s]+$/.test(e))) return setError("Enter email addresses separated by commas.");
    if (draft.whole && protections.some((p) => p.sheetId === draft.sheetId && !p.range && p.id !== draft.id)) return setError("That sheet is already protected.");
    const prev = protections.find((x) => x.id === p0Id(draft));
    // A password (Excel's kind): everyone with edit access who knows it may unlock the sheet.
    const keepHash = draft.whole && !draft.noPassword && !draft.password && prev && hasPassword(sheetPassword(prev));
    const passworded = draft.whole && !draft.noPassword && (!!draft.password || !!keepHash);
    const p: Protection = {
      id: draft.id,
      sheetId: draft.sheetId,
      range,
      editors: Array.from(new Set([...(passworded ? ["*"] : []), ...draft.editors, ...extra])),
      ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
      ...(draft.whole && except.length ? { except } : {}),
    };
    const xlsx = { ...withoutPassword(prev?.xlsx), ...(draft.password && passworded ? hashPassword(draft.password) : keepHash ? sheetPassword(prev!)! : {}) };
    if (Object.keys(xlsx).length) p.xlsx = xlsx;
    if (draft.whole && except.length) {
      const rangeHash = draft.rangePassword ? hashPassword(draft.rangePassword) : null;
      const before = prev?.except?.map(rectText) || [];
      const passwords = except.map((r) => rangeHash || prev?.exceptPasswords?.[before.indexOf(rectText(r))] || null);
      if (passwords.some(Boolean)) p.exceptPasswords = passwords;
    }
    const list = prev ? protections.map((x) => (x.id === p.id ? p : x)) : [...protections, p];
    try {
      await onSave(list);
      setDraft(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const p0Id = (d: Draft) => d.id;

  const remove = async (p: Protection) => {
    if (!confirm(`Remove the protection on ${p.range ? rectText(p.range) : `sheet ${sheetName(p.sheetId)}`}?`)) return;
    await onSave(protections.filter((x) => x.id !== p.id)).catch((e) => alert((e as Error).message));
  };

  const candidates = Array.from(new Set([...people, ...(draft?.editors || [])]));

  return (
    <aside aria-label="Protected sheets and ranges" className="flex w-[330px] shrink-0 flex-col border-l border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h2 className="text-sm font-semibold text-slate-700">Protected sheets and ranges</h2>
        <button type="button" aria-label="Close protection panel" onClick={onClose} className="rounded px-1.5 text-slate-400 hover:bg-slate-200">
          ×
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 text-xs text-slate-700">
        {draft ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="flex gap-3">
              <label className="flex items-center gap-1">
                <input type="radio" checked={!draft.whole} onChange={() => setDraft({ ...draft, whole: false })} /> Range
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={draft.whole} onChange={() => setDraft({ ...draft, whole: true })} /> Sheet
              </label>
            </div>
            <label className="block">
              <span className="text-slate-500">Sheet</span>
              <select className={input} value={draft.sheetId} onChange={(e) => setDraft({ ...draft, sheetId: e.target.value })}>
                {sheets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {draft.whole ? (
              <label className="block">
                <span className="text-slate-500">Except these ranges (anyone with edit access can change them)</span>
                <input aria-label="Except ranges" className={input} placeholder="e.g. B2:B20, D4" value={draft.except} onChange={(e) => setDraft({ ...draft, except: e.target.value })} />
              </label>
            ) : null}
            {draft.whole ? (
              <>
                <label className="block">
                  <span className="text-slate-500">Password for those ranges (optional; asked before editing them)</span>
                  <input type="password" aria-label="Range password" className={input} value={draft.rangePassword} onChange={(e) => setDraft({ ...draft, rangePassword: e.target.value })} />
                </label>
                <label className="block">
                  <span className="text-slate-500">Password to unprotect the sheet (optional; as in Excel, it holds for everyone, you too)</span>
                  <input
                    type="password"
                    aria-label="Sheet password"
                    className={input}
                    disabled={draft.noPassword}
                    placeholder={protections.some((x) => x.id === draft.id && hasPassword(sheetPassword(x))) ? "Leave blank to keep the password" : ""}
                    value={draft.password}
                    onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                  />
                </label>
                {protections.some((x) => x.id === draft.id && hasPassword(sheetPassword(x))) && (
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={draft.noPassword} onChange={(e) => setDraft({ ...draft, noPassword: e.target.checked })} /> Remove the password
                  </label>
                )}
              </>
            ) : (
              <label className="block">
                <span className="text-slate-500">Range</span>
                <div className="flex gap-1">
                  <input aria-label="Protected range" className={input} value={draft.range} onChange={(e) => setDraft({ ...draft, range: e.target.value })} />
                  <button
                    type="button"
                    className={btn}
                    onClick={() => {
                      const sel = selection();
                      if (sel) setDraft({ ...draft, range: rectText(sel), sheetId: activeSheetId || draft.sheetId });
                    }}
                  >
                    Selection
                  </button>
                </div>
              </label>
            )}
            <label className="block">
              <span className="text-slate-500">Description</span>
              <input aria-label="Description" className={input} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </label>
            <fieldset className="space-y-1">
              <legend className="text-slate-500">Who can edit</legend>
              <div className="text-slate-500">You (owner)</div>
              {candidates.map((email) => (
                <label key={email} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={draft.editors.includes(email)}
                    onChange={(e) => setDraft({ ...draft, editors: e.target.checked ? [...draft.editors, email] : draft.editors.filter((x) => x !== email) })}
                  />
                  {email}
                </label>
              ))}
              <input aria-label="More editors" className={input} placeholder="Other people's emails" value={draft.extra} onChange={(e) => setDraft({ ...draft, extra: e.target.value })} />
            </fieldset>
            {error && <p className="text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className={btn} onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="submit" className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700">
                Save protection
              </button>
            </div>
          </form>
        ) : (
          <>
            {isOwner && (
              <div className="mb-3 flex gap-2">
                <button type="button" className={btn} onClick={() => fresh("range")}>
                  Protect range
                </button>
                <button type="button" className={btn} onClick={() => fresh("sheet")}>
                  Protect sheet
                </button>
              </div>
            )}
            {!protections.length && <p className="text-slate-500">Nothing in this spreadsheet is protected.</p>}
            <ul className="space-y-2">
              {protections.map((p) => {
                const mine = canEditProtection(p, actor);
                return (
                  <li key={p.id} className="rounded border border-slate-200 bg-white p-2" data-protection={p.id}>
                    <button type="button" className="block w-full text-left" onClick={() => onSelect(p)}>
                      <div className="font-medium">
                        {sheetName(p.sheetId)}
                        {p.range ? `!${rectText(p.range)}` : " (whole sheet)"}
                      </div>
                      {p.description && <div className="text-slate-500">{p.description}</div>}
                      {!p.range && p.except?.length ? <div className="text-slate-500">Except {p.except.map(rectText).join(", ")}{p.exceptPasswords?.some(hasPassword) ? " (with a password)" : ""}</div> : null}
                      {hasPassword(sheetPassword(p)) && <div className="text-slate-500" data-password>Password protected</div>}
                      <div className={mine ? "text-emerald-700" : "text-amber-700"}>
                        {mine ? "You can edit this" : "You can't edit this"}
                        {p.editors.includes("*") ? " · Anyone with edit access who has the password" : p.editors.length ? ` · Owner and ${p.editors.join(", ")}` : " · Only the owner"}
                      </div>
                    </button>
                    {isOwner && (
                      <div className="mt-1 flex gap-2">
                        <button type="button" className={btn} onClick={() => setDraft(toDraft(p))}>
                          Edit
                        </button>
                        <button type="button" className={btn} onClick={() => void remove(p)}>
                          Remove
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}
