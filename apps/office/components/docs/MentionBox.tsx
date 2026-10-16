"use client";

// A comment box that suggests people after "@" (the document's owner, the
// people it is shared with and earlier commenters), and comment text with the
// @mentions picked out.
import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import { MENTION } from "@/lib/slides/comments";

/** The "@partial" being typed just before the caret, if any. */
export function mentionQuery(text: string, caret: number): { start: number; q: string } | null {
  const m = /(^|[\s(])@([A-Za-z0-9._%+-]*(?:@[A-Za-z0-9.-]*)?)$/.exec(text.slice(0, caret));
  return m ? { start: caret - m[2].length - 1, q: m[2].toLowerCase() } : null;
}

export function MentionBox({
  value,
  onChange,
  people,
  placeholder,
  testId,
  autoFocus,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  people: { email: string; name?: string }[];
  placeholder: string;
  testId?: string;
  autoFocus?: boolean;
  onSubmit?: () => void;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [hi, setHi] = useState(0);
  const query = mentionQuery(value, caret);
  const matches = useMemo(
    () => (query ? people.filter((p) => p.email.toLowerCase().includes(query.q) || (p.name || "").toLowerCase().includes(query.q)).slice(0, 6) : []),
    [query, people],
  );
  const pick = (email: string) => {
    if (!query) return;
    const next = `${value.slice(0, query.start)}@${email} ${value.slice(caret)}`;
    onChange(next);
    const at = query.start + email.length + 2;
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(at, at);
      setCaret(at);
    });
  };
  return (
    <div className="relative">
      <textarea
        ref={ta}
        autoFocus={autoFocus}
        value={value}
        data-testid={testId}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart);
          setHi(0);
        }}
        onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
        onKeyDown={(e) => {
          if (matches.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => (h + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(matches[Math.min(hi, matches.length - 1)].email);
              return;
            }
          }
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onSubmit?.();
        }}
        placeholder={placeholder}
        rows={2}
        className="w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
      />
      {matches.length > 0 && (
        <div className="absolute left-0 right-0 z-20 mt-0.5 rounded-md border border-slate-200 bg-white shadow-md text-xs" data-testid="mention-list">
          {matches.map((p, i) => (
            <button
              key={p.email}
              type="button"
              data-mention={p.email}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p.email);
              }}
              className={`block w-full text-left px-2 py-1.5 ${i === hi ? "bg-indigo-50" : "hover:bg-slate-50"}`}
            >
              {p.name && p.name !== p.email ? <span className="font-medium text-slate-700">{p.name} </span> : null}
              <span className="text-slate-500">{p.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Comment text with @mentions highlighted (yours more strongly). */
export function MentionText({ text, me }: { text: string; me: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION)) {
    const at = m.index!;
    parts.push(<Fragment key={`t${at}`}>{text.slice(last, at)}</Fragment>);
    const mine = m[1].toLowerCase() === me.toLowerCase();
    parts.push(
      <span key={at} data-testid="comment-mention" className={`rounded px-0.5 font-medium ${mine ? "bg-amber-100 text-amber-800" : "bg-indigo-50 text-indigo-700"}`}>
        {m[0]}
      </span>,
    );
    last = at + m[0].length;
  }
  parts.push(<Fragment key="end">{text.slice(last)}</Fragment>);
  return <>{parts}</>;
}
