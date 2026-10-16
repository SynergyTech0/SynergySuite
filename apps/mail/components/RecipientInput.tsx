"use client";
import { BookUser, Building2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";

type Suggestion = { name: string; email: string; source: "contact" | "directory" };

/** The word being typed: whatever follows the last comma or semicolon. */
function current(value: string): { head: string; word: string } {
  const i = Math.max(value.lastIndexOf(","), value.lastIndexOf(";"));
  return { head: i < 0 ? "" : value.slice(0, i + 1) + " ", word: value.slice(i + 1).trim() };
}

/** A To, Cc or Bcc box that suggests people from Contacts and the directory as you type. */
export function RecipientInput({ value, onChange, autoFocus, label }: { value: string; onChange: (v: string) => void; autoFocus?: boolean; label: string }) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const { word } = current(value);
    if (!open || word.length < 2 || word.includes("<")) {
      setItems([]);
      return;
    }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const found = await api<Suggestion[]>(`/api/people?q=${encodeURIComponent(word)}`).catch(() => []);
      if (n !== seq.current) return;
      // Leave out people already on the line.
      const have = value.toLowerCase();
      setItems(found.filter((s) => !have.includes(`<${s.email.toLowerCase()}>`)));
      setActive(0);
    }, 150);
    return () => clearTimeout(t);
  }, [value, open]);

  const pick = (s: Suggestion) => {
    const name = s.name && s.name !== s.email ? `${s.name.replace(/[",<>]/g, "")} <${s.email}>` : s.email;
    onChange(`${current(value).head}${name}, `);
    setItems([]);
  };

  return (
    <span className="recipients">
      <input
        value={value}
        aria-label={label}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={items.length > 0}
        aria-autocomplete="list"
        onChange={(e) => {
          setOpen(true);
          onChange(e.target.value);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!items.length) return;
          if (e.key === "ArrowDown") setActive((a) => (a + 1) % items.length);
          else if (e.key === "ArrowUp") setActive((a) => (a - 1 + items.length) % items.length);
          else if (e.key === "Enter" || e.key === "Tab") pick(items[active]);
          else if (e.key === "Escape") setItems([]);
          else return;
          e.preventDefault();
        }}
      />
      {items.length > 0 && open && (
        <ul className="suggestions" role="listbox" aria-label="Suggested people">
          {items.map((s, i) => (
            <li key={s.email} role="option" aria-selected={i === active} className={i === active ? "on" : ""} onMouseDown={(e) => { e.preventDefault(); pick(s); }}>
              {s.source === "contact" ? <BookUser size={15} aria-label="Contact" /> : <Building2 size={15} aria-label="Directory" />}
              <span className="sname">{s.name}</span>
              <span className="muted small">{s.email}</span>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
