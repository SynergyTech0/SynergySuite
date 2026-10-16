"use client";
// The components made of rows: task list, voting table, progress tracker and Q&A. Each row is a
// Y.Map in the shared array "items", so everyone's changes merge as they make them.
import { ArrowBigUp, Check, MessageSquare, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import * as Y from "yjs";
import { PROGRESS_STATUSES, STATUS_LABEL, newItem, randomId } from "@/lib/ydoc.mjs";
import { type Me, colorFor, initials, rowOf, useItems } from "./client";

type Props = { doc: Y.Doc; me: Me; readOnly: boolean; people: string[] };

function set(doc: Y.Doc, id: string, key: string, value: unknown) {
  const row = rowOf(doc, id);
  if (row && row.get(key) !== value) row.set(key, value);
}

function remove(doc: Y.Doc, id: string) {
  const arr = doc.getArray("items");
  const i = arr.toArray().findIndex((m) => m instanceof Y.Map && m.get("id") === id);
  if (i >= 0) arr.delete(i, 1);
}

function toggleVote(doc: Y.Doc, id: string, email: string) {
  const v = rowOf(doc, id)?.get("votes");
  if (!(v instanceof Y.Map)) return;
  if (v.has(email)) v.delete(email);
  else v.set(email, true);
}

/** A text box that writes to the shared row when you leave it or press Enter, not on every key. */
function Field({ value, onSave, placeholder, readOnly, className, list }: {
  value: string; onSave: (v: string) => void; placeholder?: string; readOnly: boolean; className?: string; list?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className={`cell ${className ?? ""}`}
      value={draft ?? value}
      placeholder={placeholder}
      readOnly={readOnly}
      list={list}
      onFocus={() => setDraft(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft !== value) onSave(draft.trim());
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (title: string) => void }) {
  const [v, setV] = useState("");
  return (
    <form
      className="addrow"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onAdd(v.trim());
        setV("");
      }}
    >
      <Plus size={16} />
      <input className="cell" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </form>
  );
}

function Avatar({ email }: { email: string }) {
  return (
    <span className="avatar small" style={{ background: colorFor(email) }} title={email}>
      {initials(email)}
    </span>
  );
}

function PeopleList({ id, people }: { id: string; people: string[] }) {
  return (
    <datalist id={id}>
      {people.map((p) => (
        <option key={p} value={p} />
      ))}
    </datalist>
  );
}

export function TasksView({ doc, readOnly, people }: Props) {
  const items = useItems(doc);
  const listId = `people-${doc.guid}`;
  const done = items.filter((t) => t.done).length;
  return (
    <div className="rows">
      <PeopleList id={listId} people={people} />
      <div className="rowhead tasks">
        <span />
        <span>Task</span>
        <span>Assigned to</span>
        <span>Due</span>
        <span />
      </div>
      {items.map((t) => (
        <div key={t.id} className={`row tasks${t.done ? " done" : ""}`}>
          <button
            className={`tick${t.done ? " on" : ""}`}
            aria-label={t.done ? "Mark not done" : "Mark done"}
            disabled={readOnly}
            onClick={() => set(doc, t.id, "done", !t.done)}
          >
            {t.done && <Check size={13} strokeWidth={3} />}
          </button>
          <Field value={t.title ?? ""} placeholder="Task" readOnly={readOnly} onSave={(v) => set(doc, t.id, "title", v)} className="strong" />
          <Field value={t.assignee ?? ""} placeholder="Someone" readOnly={readOnly} list={listId} onSave={(v) => set(doc, t.id, "assignee", v)} />
          <input
            type="date"
            className="cell"
            value={t.due ?? ""}
            readOnly={readOnly}
            onChange={(e) => !readOnly && set(doc, t.id, "due", e.target.value)}
            aria-label="Due date"
          />
          {!readOnly ? (
            <button className="iconbtn small rowdel" aria-label="Delete task" onClick={() => remove(doc, t.id)}>
              <Trash2 size={14} />
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
      {!readOnly && <AddRow placeholder="Add a task" onAdd={(title) => doc.getArray("items").push([newItem("tasks", { title })])} />}
      {items.length > 0 && <div className="rowfoot muted small">{done} of {items.length} done</div>}
    </div>
  );
}

export function VotingView({ doc, me, readOnly }: Props) {
  const items = useItems(doc);
  const total = items.reduce((n, o) => n + (o.votes?.length ?? 0), 0);
  return (
    <div className="rows">
      <div className="rowhead voting">
        <span>Option</span>
        <span>Notes</span>
        <span>Votes</span>
        <span />
      </div>
      {items.map((o) => {
        const votes: string[] = o.votes ?? [];
        const mine = votes.includes(me.email);
        const share = total ? Math.round((votes.length / total) * 100) : 0;
        return (
          <div key={o.id} className="row voting">
            <Field value={o.title ?? ""} placeholder="Option" readOnly={readOnly} onSave={(v) => set(doc, o.id, "title", v)} className="strong" />
            <Field value={o.notes ?? ""} placeholder="Notes" readOnly={readOnly} onSave={(v) => set(doc, o.id, "notes", v)} />
            <div className="votecell">
              <button
                className={`vote${mine ? " on" : ""}`}
                disabled={readOnly}
                onClick={() => toggleVote(doc, o.id, me.email)}
                title={votes.length ? votes.join(", ") : "No votes yet"}
              >
                <ArrowBigUp size={15} /> {votes.length}
              </button>
              <span className="bar" aria-hidden>
                <span style={{ width: `${share}%` }} />
              </span>
              <span className="voters">{votes.slice(0, 4).map((v) => <Avatar key={v} email={v} />)}</span>
            </div>
            {!readOnly ? (
              <button className="iconbtn small rowdel" aria-label="Delete option" onClick={() => remove(doc, o.id)}>
                <Trash2 size={14} />
              </button>
            ) : (
              <span />
            )}
          </div>
        );
      })}
      {!readOnly && <AddRow placeholder="Add an option" onAdd={(title) => doc.getArray("items").push([newItem("voting", { title })])} />}
    </div>
  );
}

export function ProgressView({ doc, readOnly, people }: Props) {
  const items = useItems(doc);
  const listId = `people-${doc.guid}`;
  const done = items.filter((i) => i.status === "done").length;
  return (
    <div className="rows">
      <PeopleList id={listId} people={people} />
      {items.length > 0 && (
        <div className="progress" aria-label={`${done} of ${items.length} done`}>
          {PROGRESS_STATUSES.map((s) => {
            const n = items.filter((i) => i.status === s).length;
            return n ? <span key={s} className={`seg ${s}`} style={{ flex: n }} title={`${STATUS_LABEL[s]}: ${n}`} /> : null;
          })}
        </div>
      )}
      <div className="rowhead progressrow">
        <span>Item</span>
        <span>Status</span>
        <span>Owner</span>
        <span>Notes</span>
        <span />
      </div>
      {items.map((i) => (
        <div key={i.id} className="row progressrow">
          <Field value={i.title ?? ""} placeholder="Item" readOnly={readOnly} onSave={(v) => set(doc, i.id, "title", v)} className="strong" />
          <select
            className={`status ${i.status}`}
            value={i.status}
            disabled={readOnly}
            onChange={(e) => set(doc, i.id, "status", e.target.value)}
            aria-label="Status"
          >
            {PROGRESS_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <Field value={i.owner ?? ""} placeholder="Someone" readOnly={readOnly} list={listId} onSave={(v) => set(doc, i.id, "owner", v)} />
          <Field value={i.notes ?? ""} placeholder="Notes" readOnly={readOnly} onSave={(v) => set(doc, i.id, "notes", v)} />
          {!readOnly ? (
            <button className="iconbtn small rowdel" aria-label="Delete item" onClick={() => remove(doc, i.id)}>
              <Trash2 size={14} />
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
      {!readOnly && <AddRow placeholder="Add an item" onAdd={(title) => doc.getArray("items").push([newItem("progress", { title })])} />}
      {items.length > 0 && <div className="rowfoot muted small">{done} of {items.length} done</div>}
    </div>
  );
}

function Answer({ onAdd }: { onAdd: (text: string) => void }) {
  const [v, setV] = useState("");
  return (
    <form
      className="answerform"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onAdd(v.trim());
        setV("");
      }}
    >
      <input className="cell" value={v} onChange={(e) => setV(e.target.value)} placeholder="Answer…" aria-label="Your answer" />
    </form>
  );
}

export function QAView({ doc, me, readOnly }: Props) {
  const items = useItems(doc);
  const sorted = [...items].sort((a, b) => (b.votes?.length ?? 0) - (a.votes?.length ?? 0));
  return (
    <div className="qa">
      {!readOnly && <AddRow placeholder="Ask a question" onAdd={(title) => doc.getArray("items").push([newItem("qa", { title, by: me.email })])} />}
      {sorted.length === 0 && <p className="muted small pad0">No questions yet.</p>}
      {sorted.map((item) => {
        const votes: string[] = item.votes ?? [];
        const answers: { id: string; text: string; by: string }[] = item.answers ?? [];
        return (
          <div key={item.id} className="question">
            <button
              className={`vote tall${votes.includes(me.email) ? " on" : ""}`}
              disabled={readOnly}
              onClick={() => toggleVote(doc, item.id, me.email)}
              title={votes.length ? votes.join(", ") : "Upvote"}
            >
              <ArrowBigUp size={16} />
              {votes.length}
            </button>
            <div className="grow">
              <div className="qtitle">
                <strong>{item.title}</strong>
                {item.by && <span className="muted small"> · {item.by}</span>}
                {!readOnly && (item.by === me.email || !item.by) && (
                  <button className="iconbtn small" aria-label="Delete question" onClick={() => remove(doc, item.id)}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              {answers.map((a) => (
                <div key={a.id} className="answer">
                  <MessageSquare size={13} />
                  <span className="grow">{a.text}</span>
                  <span className="muted small">{a.by}</span>
                </div>
              ))}
              {!readOnly && (
                <Answer
                  onAdd={(text) => {
                    const arr = rowOf(doc, item.id)?.get("answers");
                    if (!(arr instanceof Y.Array)) return;
                    const a = new Y.Map();
                    a.set("id", randomId());
                    a.set("text", text);
                    a.set("by", me.email);
                    arr.push([a]);
                  }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
