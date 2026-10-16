"use client";
import { ArrowLeft, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { label } from "./client";

export type Say = (text: string) => void;

export function Pill({ s, text }: { s: string; text?: string }) {
  return <span className={`st st-${s}`}>{text ?? label(s)}</span>;
}

/** The list half of a screen: title row, optional search and filters, then the body. */
export function ListPane({ title, actions, query, onQuery, filters, children, placeholder }: {
  title: string; actions?: React.ReactNode; query?: string; onQuery?: (q: string) => void; filters?: React.ReactNode; children: React.ReactNode; placeholder?: string;
}) {
  return (
    <section className="listpane">
      <div className="listhead">
        <div className="titlerow">
          <h1 className="grow">{title}</h1>
          {actions}
        </div>
        {(onQuery || filters) && (
          <div className="titlerow">
            {onQuery && (
              <label className="search grow">
                <Search size={16} />
                <input value={query ?? ""} onChange={(e) => onQuery(e.target.value)} placeholder={placeholder ?? "Search"} aria-label="Search" />
              </label>
            )}
            {filters}
          </div>
        )}
      </div>
      <div className="listbody">{children}</div>
    </section>
  );
}

export function Filters<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="filters" role="tablist">
      {options.map(([v, t]) => (
        <button key={v} role="tab" aria-selected={value === v} className={`chip${value === v ? " on" : ""}`} onClick={() => onChange(v)}>
          {t}
        </button>
      ))}
    </div>
  );
}

/** The detail half: a sticky header with the record's name and actions, then cards. */
export function DetailPane({ title, sub, tools, onClose, children }: { title: React.ReactNode; sub?: React.ReactNode; tools?: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <aside className="detail">
      <div className="dhead">
        <div className="dtitle">
          <button className="iconbtn back" aria-label="Back" onClick={onClose}><ArrowLeft size={18} /></button>
          <h2>{title}</h2>
          <button className="iconbtn" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        {sub && <div className="toolbar small muted">{sub}</div>}
        {tools && <div className="toolbar">{tools}</div>}
      </div>
      <div className="dbody">{children}</div>
    </aside>
  );
}

export function Empty({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return <div className="empty">{icon}{children}</div>;
}

export function Card({ title, actions, children }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card">
      {(title || actions) && (
        <div className="titlerow">
          {title && <h3 className="grow" style={{ margin: 0 }}>{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

/** A controlled set of string fields for forms; numbers stay strings until the server checks them. */
export function useFields<T extends Record<string, string>>(initial: T) {
  const [v, setV] = useState<T>(initial);
  const bind = (k: keyof T) => ({ value: v[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((o) => ({ ...o, [k]: e.target.value })) });
  return { v, setV, bind };
}

/** Runs an action with a busy flag and shows its error inline. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

/** Re-runs `load` whenever `deps` change, with a short pause while someone is typing a search. */
export function useLoad(load: () => Promise<void>, deps: unknown[], typing = false) {
  useEffect(() => {
    const t = window.setTimeout(() => void load(), typing ? 200 : 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function Field({ label: l, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <span>{l}</span>
      {children}
    </label>
  );
}
