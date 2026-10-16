"use client";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import type { PersonRef } from "@/lib/types";
import { api, initials, personColor, personHref, topicHref } from "./client";

export function Avatar({ person, size = 36 }: { person: PersonRef; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, background: personColor(person.email) }} aria-hidden>
      {initials(person.name)}
    </span>
  );
}

const TOKEN = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])|@([^\s@<>()[\]]+@[^\s@<>()[\]]+\.[a-z]{2,})|(^|[^\p{L}\p{N}_&/])#([\p{L}\p{N}_-]{2,40})/giu;

/** Post text: paragraphs, links, @mentions as people and #topics as topic links. Never HTML. */
export function RichText({ text, people = [] }: { text: string; people?: PersonRef[] }) {
  const names = new Map(people.map((p) => [p.email.toLowerCase(), p.name]));
  const paras = text.split(/\n{2,}/);
  return (
    <div className="rich">
      {paras.map((para, i) => (
        <p key={i}>
          {para.split("\n").map((line, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {render(line, names)}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}

function render(line: string, names: Map<string, string>): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (m[1]) {
      out.push(line.slice(last, at), <a key={at} href={m[1]} target="_blank" rel="noreferrer noopener">{m[1]}</a>);
    } else if (m[2]) {
      const email = m[2].toLowerCase().replace(/[.,;:!?]+$/, "");
      out.push(line.slice(last, at), <Link key={at} className="mention" href={personHref(email)}>@{names.get(email) ?? email.split("@")[0]}</Link>);
      out.push(m[2].slice(email.length));
    } else {
      out.push(line.slice(last, at), m[3], <Link key={at} className="topic" href={topicHref(m[4].toLowerCase())}>#{m[4]}</Link>);
    }
    last = at + m[0].length;
  }
  out.push(line.slice(last));
  return out;
}

type Found = PersonRef & { title: string; department: string };

/** A search box over the people who use Engage; typing a full email address offers that too. */
export function PeoplePicker({ onPick, exclude = [], placeholder = "Search people", autoFocus }: {
  onPick: (p: PersonRef) => void; exclude?: string[]; placeholder?: string; autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      api<Found[]>(`/api/people?q=${encodeURIComponent(query)}`).then(setFound, () => setFound([]));
    }, 150);
    return () => window.clearTimeout(t);
  }, [query, open]);

  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const typed = query.trim().toLowerCase();
  const list = found.filter((p) => !exclude.includes(p.email));
  const extra = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed) && !list.some((p) => p.email === typed) && !exclude.includes(typed);
  const pick = (p: PersonRef) => {
    onPick(p);
    setQuery("");
    setOpen(false);
  };
  return (
    <div className="picker" ref={box}>
      <input
        value={query}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (list[0]) pick(list[0]);
            else if (extra) pick({ email: typed, name: typed });
          }
        }}
      />
      {open && (list.length > 0 || extra) && (
        <ul className="pickmenu">
          {list.slice(0, 8).map((p) => (
            <li key={p.email}>
              <button type="button" onClick={() => pick(p)}>
                <Avatar person={p} size={26} />
                <span className="grow">
                  <b>{p.name}</b>
                  <span className="muted small"> {p.title || p.email}</span>
                </span>
              </button>
            </li>
          ))}
          {extra && (
            <li>
              <button type="button" onClick={() => pick({ email: typed, name: typed })}>
                <Avatar person={{ email: typed, name: typed }} size={26} />
                <span className="grow">{typed}</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export function Toast({ text, onClose }: { text: string | null; onClose: () => void }) {
  useEffect(() => {
    if (!text) return;
    const t = window.setTimeout(onClose, 5000);
    return () => window.clearTimeout(t);
  }, [text, onClose]);
  return text ? <div className="toast" role="status">{text}</div> : null;
}
