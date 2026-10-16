"use client";
// Pieces several Admin screens use: badges, avatars, the people and app pickers.
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Me } from "@/lib/types";
import { api, hue, initials, type Route, type View } from "./client";

export type AppInfo = { id: string; name: string; content: boolean };

/** What every screen gets from the app: who you are, the suite's apps, and how to move around. */
export type AppCtx = {
  me: Me;
  apps: AppInfo[];
  authConsole: string;
  go: (r: Partial<Route> & { view: View }) => void;
  say: (text: string) => void;
};

export const isAdmin = (app: AppCtx) => app.me.role === "admin";

export function appLabel(app: AppCtx, id: string): string {
  return app.apps.find((a) => a.id === id)?.name ?? id;
}

/** "All apps" or the names of the ones picked. */
export function appsText(app: AppCtx, ids: string[]): string {
  return ids.length ? ids.map((id) => appLabel(app, id)).join(", ") : "All apps";
}

export function Badge({ tone = "", children }: { tone?: string; children: React.ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Avatar({ name }: { name: string }) {
  const h = hue(name);
  return (
    <span className="avatar" style={{ background: `hsl(${h} 70% 92%)`, color: `hsl(${h} 55% 32%)` }} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="facts">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v === "" || v === null || v === undefined ? <span className="muted">—</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Email addresses as chips: type one (Enter, comma or space adds it), paste a list, or pick
 * someone the directory suggests.
 */
export function PeoplePicker({ value, onChange, label, placeholder = "Name or email address" }: {
  value: string[]; onChange: (v: string[]) => void; label: string; placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const [hints, setHints] = useState<{ email: string; name: string }[]>([]);
  const [pick, setPick] = useState(0);
  const [bad, setBad] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    const s = draft.trim();
    if (s.length < 2) {
      setHints([]);
      return;
    }
    const n = ++seq.current;
    const t = setTimeout(() => {
      void api<{ email: string; name: string }[]>(`/api/custodians?q=${encodeURIComponent(s)}`)
        .then((r) => n === seq.current && (setHints(r.filter((h) => !value.includes(h.email))), setPick(0)))
        .catch(() => {});
    }, 150);
    return () => clearTimeout(t);
  }, [draft, value]);

  const add = (raw: string) => {
    const parts = raw.split(/[\s,;]+/).map((p) => p.trim().toLowerCase()).filter(Boolean);
    const good = parts.filter((p) => EMAIL.test(p));
    const wrong = parts.filter((p) => !EMAIL.test(p));
    if (good.length) onChange([...new Set([...value, ...good])]);
    setBad(wrong.length ? `"${wrong[0]}" is not an email address` : "");
    setDraft(wrong.join(" "));
    setHints([]);
  };

  return (
    <div className="picker">
      <div className="box" onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement)?.focus()}>
        {value.map((e) => (
          <span key={e} className="chip">
            {e}
            <button type="button" aria-label={`Remove ${e}`} onClick={() => onChange(value.filter((x) => x !== e))}><X size={12} /></button>
          </span>
        ))}
        <input
          aria-label={label}
          value={draft}
          placeholder={value.length ? "" : placeholder}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;\s]$/.test(v) && v.trim()) add(v);
            else setDraft(v);
          }}
          onPaste={(e) => {
            const t = e.clipboardData.getData("text");
            if (/[,;\s]/.test(t.trim())) {
              e.preventDefault();
              add(t);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (hints[pick] && !EMAIL.test(draft.trim())) add(hints[pick].email);
              else if (draft.trim()) add(draft);
            } else if (e.key === "ArrowDown" && hints.length) {
              e.preventDefault();
              setPick((p) => Math.min(p + 1, hints.length - 1));
            } else if (e.key === "ArrowUp" && hints.length) {
              e.preventDefault();
              setPick((p) => Math.max(p - 1, 0));
            } else if (e.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            } else if (e.key === "Escape") {
              setHints([]);
            }
          }}
          onBlur={() => setTimeout(() => {
            setHints([]);
            if (EMAIL.test(draft.trim())) add(draft);
          }, 150)}
        />
      </div>
      {hints.length ? (
        <div className="suggest" role="listbox">
          {hints.map((h, i) => (
            <button key={h.email} type="button" role="option" aria-selected={i === pick} className={i === pick ? "on" : ""} onMouseDown={(e) => { e.preventDefault(); add(h.email); }}>
              <span>{h.name || h.email}</span>
              {h.name ? <span className="muted small">{h.email}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {bad ? <p className="error small">{bad}</p> : null}
    </div>
  );
}

/** Every app ([]), or some of them. */
export function AppPicker({ app, value, onChange, contentOnly = true }: { app: AppCtx; value: string[]; onChange: (v: string[]) => void; contentOnly?: boolean }) {
  const list = contentOnly ? app.apps.filter((a) => a.content) : app.apps;
  const some = value.length > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="seg" role="radiogroup" aria-label="Apps">
        <button type="button" role="radio" aria-checked={!some} className={!some ? "on" : ""} onClick={() => onChange([])}>All apps</button>
        <button type="button" role="radio" aria-checked={some} className={some ? "on" : ""} onClick={() => !some && onChange(list.slice(0, 1).map((a) => a.id))}>Some apps</button>
      </div>
      {some ? (
        <div className="appchecks">
          {list.map((a) => (
            <label key={a.id}>
              <input
                type="checkbox"
                checked={value.includes(a.id)}
                onChange={(e) => {
                  const next = e.target.checked ? [...value, a.id] : value.filter((x) => x !== a.id);
                  onChange(next.length ? next.sort() : value);
                }}
              />
              {a.name}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
