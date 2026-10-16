"use client";
import { Bell, CalendarDays, Circle, CircleCheck, List as ListIcon, Plus, Repeat as RepeatIcon, Star, Sun, Trash2, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { List, Task } from "@/lib/types";
import { addDaysStr, api, dueLabel, localInput, person, REPEAT_LABELS, timeLabel } from "./client";

type Props = {
  t: Task;
  today: string;
  me: string;
  lists: List[];
  onPatch: (change: Record<string, unknown>) => Promise<unknown>;
  onReload: () => Promise<void>;
  onDelete: () => void;
  onClose: () => void;
  onError: (msg: string) => void;
};

/** The right-hand panel for one task. */
export function TaskDetails({ t, today, me, lists, onPatch, onReload, onDelete, onClose, onError }: Props) {
  const [title, setTitle] = useState(t.title);
  const [notes, setNotes] = useState(t.notes);
  const [picker, setPicker] = useState<"" | "due" | "remind" | "repeat">("");
  const stepRef = useRef<HTMLInputElement>(null);
  const list = lists.find((l) => l.id === t.listId);
  const people = list ? [list.owner, ...list.members] : [];

  useEffect(() => setTitle(t.title), [t.title]);
  useEffect(() => setNotes(t.notes), [t.notes]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !picker && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, picker]);

  const step = async (path: string, init: RequestInit & { json?: unknown }) => {
    try {
      await api(`/api/tasks/${t.id}/steps${path}`, init);
      await onReload();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const remind = async (at: Date) => {
    // Ask once for permission to pop up a notification; the in-app reminder works either way.
    if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission().catch(() => {});
    await onPatch({ reminderAt: at.toISOString() });
    setPicker("");
  };

  const at = (dayOffset: number, hour: number) => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const laterToday = new Date(Date.now() + 3 * 3600_000);
  laterToday.setMinutes(0, 0, 0);

  return (
    <aside className="details" aria-label="Task details">
      <div className="detailsbody">
        <section className="card titlecard">
          <div className="dtitle">
            <button className="checkbtn" aria-label={t.completedAt ? "Mark not completed" : "Complete task"} onClick={() => void onPatch({ completed: !t.completedAt, completedAt: t.completedAt ? null : new Date().toISOString() })}>
              {t.completedAt ? <CircleCheck size={22} /> : <Circle size={22} />}
            </button>
            <textarea
              className={`titleinput${t.completedAt ? " done" : ""}`}
              aria-label="Task title"
              rows={1}
              value={title}
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
              onBlur={() => {
                if (title.trim() && title !== t.title) void onPatch({ title });
                else setTitle(t.title);
              }}
            />
            <button className={`iconbtn star${t.important ? " on" : ""}`} aria-label={t.important ? "Remove importance" : "Mark as important"} aria-pressed={t.important} onClick={() => void onPatch({ important: !t.important })}>
              <Star size={18} fill={t.important ? "currentColor" : "none"} />
            </button>
          </div>
          <ul className="steps">
            {t.steps.map((s) => (
              <li key={s.id} className={s.done ? "done" : ""}>
                <button className="checkbtn small" aria-label={s.done ? `Mark step “${s.title}” not done` : `Complete step “${s.title}”`} onClick={() => void step(`/${s.id}`, { method: "PATCH", json: { done: !s.done } })}>
                  {s.done ? <CircleCheck size={16} /> : <Circle size={16} />}
                </button>
                <input
                  aria-label="Step"
                  defaultValue={s.title}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== s.title && void step(`/${s.id}`, { method: "PATCH", json: { title: e.target.value } })}
                />
                <button className="iconbtn small" aria-label={`Delete step “${s.title}”`} onClick={() => void step(`/${s.id}`, { method: "DELETE" })}>
                  <X size={14} />
                </button>
              </li>
            ))}
            <li>
              <form
                className="addstep"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const v = stepRef.current!.value.trim();
                  if (!v) return;
                  stepRef.current!.value = "";
                  await step("", { method: "POST", json: { title: v } });
                  stepRef.current?.focus();
                }}
              >
                <Plus size={16} aria-hidden />
                <input ref={stepRef} placeholder={t.steps.length ? "Next step" : "Add step"} aria-label="Add step" />
              </form>
            </li>
          </ul>
        </section>

        <section className="card">
          <button className={`drow${t.myDay ? " set" : ""}`} onClick={() => void onPatch({ myDay: !t.myDay })}>
            <Sun size={18} /> <span className="grow">{t.myDay ? "Added to My Day" : "Add to My Day"}</span>
            {t.myDay && <X size={16} aria-label="Remove from My Day" />}
          </button>
        </section>

        <section className="card">
          <div className="pickwrap">
            <div className={`drow${t.reminderAt ? " set" : ""}`}>
              <button className="grow drowbtn" onClick={() => setPicker(picker === "remind" ? "" : "remind")} aria-expanded={picker === "remind"}>
                <Bell size={18} /> <span>{t.reminderAt ? `Remind me ${timeLabel(t.reminderAt)}` : "Remind me"}</span>
              </button>
              {t.reminderAt && <button className="iconbtn small" aria-label="Remove reminder" onClick={() => void onPatch({ reminderAt: null })}><X size={16} /></button>}
            </div>
            {picker === "remind" && (
              <div className="picker">
                {laterToday.getDate() === new Date().getDate() && <button onClick={() => void remind(laterToday)}>Later today <span>{laterToday.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></button>}
                <button onClick={() => void remind(at(1, 9))}>Tomorrow <span>9:00 AM</span></button>
                <button onClick={() => void remind(at(((8 - new Date().getDay()) % 7) || 7, 9))}>Next week <span>Mon 9:00 AM</span></button>
                <label>
                  <span>Pick a date and time</span>
                  <input type="datetime-local" defaultValue={t.reminderAt ? localInput(t.reminderAt) : ""} onChange={(e) => e.target.value && void remind(new Date(e.target.value))} />
                </label>
              </div>
            )}
          </div>

          <div className="pickwrap">
            <div className={`drow${t.due ? " set" : ""}${t.due && t.due < today && !t.completedAt ? " late" : ""}`}>
              <button className="grow drowbtn" onClick={() => setPicker(picker === "due" ? "" : "due")} aria-expanded={picker === "due"}>
                <CalendarDays size={18} /> <span>{t.due ? `Due ${dueLabel(t.due, today)}` : "Add due date"}</span>
              </button>
              {t.due && <button className="iconbtn small" aria-label="Remove due date" onClick={() => void onPatch({ due: null, repeat: null })}><X size={16} /></button>}
            </div>
            {picker === "due" && (
              <div className="picker">
                <button onClick={() => void onPatch({ due: today }).then(() => setPicker(""))}>Today</button>
                <button onClick={() => void onPatch({ due: addDaysStr(today, 1) }).then(() => setPicker(""))}>Tomorrow</button>
                <button onClick={() => void onPatch({ due: addDaysStr(today, 7) }).then(() => setPicker(""))}>Next week</button>
                <label>
                  <span>Pick a date</span>
                  <input type="date" defaultValue={t.due ?? ""} onChange={(e) => e.target.value && void onPatch({ due: e.target.value }).then(() => setPicker(""))} />
                </label>
              </div>
            )}
          </div>

          <div className="pickwrap">
            <div className={`drow${t.repeat ? " set" : ""}`}>
              <button className="grow drowbtn" onClick={() => setPicker(picker === "repeat" ? "" : "repeat")} aria-expanded={picker === "repeat"}>
                <RepeatIcon size={18} /> <span>{t.repeat ? `Repeats ${REPEAT_LABELS[t.repeat].toLowerCase()}` : "Repeat"}</span>
              </button>
              {t.repeat && <button className="iconbtn small" aria-label="Stop repeating" onClick={() => void onPatch({ repeat: null })}><X size={16} /></button>}
            </div>
            {picker === "repeat" && (
              <div className="picker">
                {Object.entries(REPEAT_LABELS).map(([k, label]) => (
                  <button key={k} className={t.repeat === k ? "on" : ""} onClick={() => void onPatch({ repeat: k }).then(() => setPicker(""))}>{label}</button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <label className="drow">
            <ListIcon size={18} />
            <select aria-label="List" value={t.listId} onChange={(e) => void onPatch({ listId: e.target.value, listName: lists.find((l) => l.id === e.target.value)?.name })}>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          {people.length > 1 && (
            <label className="drow">
              <UserRound size={18} />
              <select aria-label="Assigned to" value={t.assignedTo ?? ""} onChange={(e) => void onPatch({ assignedTo: e.target.value || null })}>
                <option value="">Not assigned</option>
                {people.map((p) => <option key={p} value={p}>{person(p, me)}{p === me ? "" : ` (${p})`}</option>)}
              </select>
            </label>
          )}
        </section>

        <section className="card">
          <textarea
            className="notes"
            aria-label="Notes"
            placeholder="Add note"
            rows={5}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== t.notes && void onPatch({ notes })}
          />
        </section>
      </div>
      <footer className="detailsfoot">
        <button className="iconbtn" aria-label="Close details" onClick={onClose}><X size={18} /></button>
        <span className="grow small muted center">
          {t.completedAt
            ? `Completed ${new Date(t.completedAt).toLocaleDateString([], { month: "short", day: "numeric" })}${t.completedBy && t.completedBy !== me ? ` by ${person(t.completedBy, me)}` : ""}`
            : `Created ${new Date(t.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}${t.createdBy !== me ? ` by ${person(t.createdBy, me)}` : ""}`}
        </span>
        <button className="iconbtn" aria-label="Delete task" onClick={onDelete}><Trash2 size={18} /></button>
      </footer>
    </aside>
  );
}
