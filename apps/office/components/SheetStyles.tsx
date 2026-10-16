"use client";

// Format > Cell styles (Excel's gallery, in the workbook theme) and
// Format > Theme (the workbook's colors and fonts).
import { Modal } from "./SheetDialogs";
import { CELL_STYLES, COLOR_SLOTS, THEMES, type CellStyleDef, type WorkbookTheme } from "@/lib/sheet-themes";
import type { UniverStyle } from "@/lib/xlsx";

const BORDER_CSS: Record<number, string> = { 1: "1px solid", 7: "3px double", 8: "2px solid", 13: "3px solid" };

/** The chip's look: the style's fill, font and borders, as CSS. */
function chipCss(s: UniverStyle): React.CSSProperties {
  const css: React.CSSProperties = {};
  if (s.bg?.rgb) css.background = s.bg.rgb;
  if (s.cl?.rgb) css.color = s.cl.rgb;
  if (s.bl) css.fontWeight = 600;
  if (s.it) css.fontStyle = "italic";
  if (s.ff) css.fontFamily = `'${s.ff}', sans-serif`;
  if (s.fs && s.fs > 11) css.fontSize = s.fs >= 15 ? 15 : 13;
  const side = (b: any) => (b?.cl?.rgb ? `${BORDER_CSS[b.s] || "1px solid"} ${b.cl.rgb}` : undefined);
  if (s.bd) {
    css.borderTop = side((s.bd as any).t);
    css.borderRight = side((s.bd as any).r);
    css.borderBottom = side((s.bd as any).b);
    css.borderLeft = side((s.bd as any).l);
  }
  return css;
}

export function CellStylesDialog({ theme, onPick, onClose }: { theme: WorkbookTheme; onPick: (def: CellStyleDef) => void; onClose: () => void }) {
  const groups = [...new Set(CELL_STYLES.map((s) => s.group))];
  return (
    <Modal title="Cell styles" onClose={onClose}>
      <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1 space-y-3">
        {groups.map((g) => (
          <section key={g}>
            <h3 className="text-xs font-medium text-slate-500 mb-1">{g}</h3>
            <div className="grid grid-cols-3 gap-1.5">
              {CELL_STYLES.filter((s) => s.group === g).map((def) => (
                <button
                  key={def.name}
                  type="button"
                  title={def.name}
                  aria-label={`Cell style ${def.name}`}
                  className="h-8 px-2 text-left text-xs truncate rounded border border-slate-200 bg-white hover:ring-2 hover:ring-indigo-300"
                  style={chipCss(def.style(theme))}
                  onClick={() => onPick(def)}
                >
                  {def.name}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}

export function ThemeDialog({ current, canEdit, onPick, onClose }: { current: WorkbookTheme; canEdit: boolean; onPick: (t: WorkbookTheme) => void; onClose: () => void }) {
  const list = THEMES.some((t) => t.name === current.name && JSON.stringify(t.colors) === JSON.stringify(current.colors)) ? THEMES : [current, ...THEMES];
  return (
    <Modal title="Theme" onClose={onClose}>
      <p className="text-xs text-slate-500 mb-2">Cells in the current theme's colors and fonts change to the new theme's.</p>
      <div className="grid grid-cols-2 gap-2 max-h-[60vh] overflow-y-auto">
        {list.map((t) => {
          const selected = t.name === current.name && JSON.stringify(t.colors) === JSON.stringify(current.colors);
          return (
            <button
              key={t.name}
              type="button"
              disabled={!canEdit}
              aria-label={`Theme ${t.name}`}
              aria-pressed={selected}
              className={`rounded-lg border p-2 text-left hover:border-indigo-400 disabled:opacity-60 ${selected ? "border-indigo-600 ring-1 ring-indigo-600" : "border-slate-200"}`}
              onClick={() => onPick(t)}
            >
              <div className="flex h-4 rounded overflow-hidden mb-1.5">
                {COLOR_SLOTS.slice(4, 10).map((k) => (
                  <span key={k} className="flex-1" style={{ background: `#${t.colors[k]}` }} />
                ))}
              </div>
              <div className="text-sm text-slate-800" style={{ fontFamily: `'${t.fonts.major}', sans-serif` }}>{t.name}</div>
              <div className="text-[11px] text-slate-500 truncate">{t.fonts.major} / {t.fonts.minor}</div>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
