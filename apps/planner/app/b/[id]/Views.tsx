"use client";
import { useMemo, useRef, useState } from "react";
import { DndContext, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { barFor, cardDayKey, dayKey, monthGrid, sortCards, timelineSpan, type Day, type SortDir, type SortKey } from "@/lib/views";
import { shortDate } from "@/lib/due";

/**
 * The non-kanban ways of looking at a board: a sortable table, a due-date calendar and a timeline.
 *
 * All three read the cards the board already has in memory and already filtered, so a quick filter or
 * the filter panel narrows every view the same way, and switching views costs nothing.
 */

export type ViewCard = {
  id: string; listId: string; title: string; issueKey?: string | null; issueType?: string;
  priority?: string; points?: number | null; isComplete?: boolean;
  dueDate?: string | Date | null; startDate?: string | Date | null;
  assignee?: { id: string; name: string; isMind: boolean } | null;
  labels?: { id: string; name: string | null; color: string }[];
};

type Common = { cards: ViewCard[]; lists: { id: string; title: string }[]; onOpen: (id: string) => void };

const TYPE_MARK: Record<string, string> = { epic: "E", story: "S", task: "T", bug: "B", subtask: "·" };
const PRIO_MARK: Record<string, string> = { highest: "⤒", high: "↑", medium: "=", low: "↓", lowest: "⤓" };
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
// Due dates are UTC midnight; shortDate reads them in UTC so the day shown is the day stored.
const fmtDue = shortDate;

/* ------------------------------------------------------------------ table */

const COLUMNS: { key: SortKey; label: string; width?: string }[] = [
  { key: "issueKey", label: "Key", width: "90px" },
  { key: "issueType", label: "Type", width: "56px" },
  { key: "title", label: "Summary" },
  { key: "listId", label: "Status", width: "130px" },
  { key: "priority", label: "Priority", width: "90px" },
  { key: "assignee", label: "Assignee", width: "130px" },
  { key: "points", label: "Pts", width: "50px" },
  { key: "dueDate", label: "Due", width: "90px" },
];

export function TableView({ cards, lists, onOpen }: Common) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "issueKey", dir: "asc" });
  const listTitle = useMemo(() => Object.fromEntries(lists.map((l) => [l.id, l.title])), [lists]);
  // Status sorts by the column's own left-to-right order, not by the list's id — the id is meaningless
  // to a reader, and board order is what "status" means here.
  const ordered = useMemo(() => {
    const rank = Object.fromEntries(lists.map((l, i) => [l.id, i]));
    const rows = sortCards(cards, sort.key, sort.dir);
    return sort.key === "listId"
      ? [...rows].sort((a, b) => ((rank[a.listId] ?? 0) - (rank[b.listId] ?? 0)) * (sort.dir === "asc" ? 1 : -1))
      : rows;
  }, [cards, lists, sort]);

  const head = (c: (typeof COLUMNS)[number]) => (
    <th key={c.key} style={c.width ? { width: c.width } : undefined}
      aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === "asc" ? "desc" : "asc" }))}>
        {c.label}{sort.key === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );

  return (
    <div className="tablewrap">
      <table className="issuetable">
        <thead><tr>{COLUMNS.map(head)}</tr></thead>
        <tbody>
          {ordered.map((c) => (
            <tr key={c.id} onClick={() => onOpen(c.id)} tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter") onOpen(c.id); }}>
              <td className="ikeycell">{c.issueKey || "—"}</td>
              <td><span className={`itype ${c.issueType || "task"}`}>{TYPE_MARK[c.issueType || "task"]}</span></td>
              <td className={c.isComplete ? "done" : undefined}>
                {c.title}
                {c.labels?.map((l) => <span key={l.id} className="tlabel" style={{ background: l.color }} title={l.name || ""} />)}
              </td>
              <td className="muted">{listTitle[c.listId] ?? "—"}</td>
              <td><span className={`prio ${c.priority || "medium"}`}>{PRIO_MARK[c.priority || "medium"]}</span> <span className="muted">{c.priority || "medium"}</span></td>
              <td className="muted">{c.assignee?.name ?? "Unassigned"}</td>
              <td className="muted">{c.points ?? ""}</td>
              <td className="muted">{c.dueDate ? fmtDue(c.dueDate) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!ordered.length && <div className="bempty">No cards match.</div>}
    </div>
  );
}

/* --------------------------------------------------------------- calendar */

const DAY_ID = "day:";

function CalCard({ card, onOpen, canEdit }: { card: ViewCard; onOpen: (id: string) => void; canEdit: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id, disabled: !canEdit });
  const down = useRef<{ x: number; y: number } | null>(null);
  // dnd-kit swallows the native click, so a click is a pointer-up within 5px of the pointer-down.
  const dndDown = (listeners as unknown as { onPointerDown?: (e: React.PointerEvent) => void })?.onPointerDown;
  return (
    <div ref={setNodeRef} {...attributes} {...listeners}
      className={`calcard${card.isComplete ? " done" : ""}${isDragging ? " drag" : ""}`}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 5 } : undefined}
      onPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY }; dndDown?.(e); }}
      onPointerUp={(e) => { const d = down.current; down.current = null; if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) onOpen(card.id); }}
      title={card.title}>
      <span className={`itype ${card.issueType || "task"}`}>{TYPE_MARK[card.issueType || "task"]}</span> {card.title}
    </div>
  );
}

function DayCell({ day, cards, onOpen, canEdit, isToday }:
  { day: Day; cards: ViewCard[]; onOpen: (id: string) => void; canEdit: boolean; isToday: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${DAY_ID}${day.key}` });
  return (
    <div ref={setNodeRef}
      className={`calday${day.inMonth ? "" : " out"}${isToday ? " today" : ""}${isOver ? " over" : ""}`}>
      <span className="caldate">{day.date.getDate()}</span>
      {cards.map((c) => <CalCard key={c.id} card={c} onOpen={onOpen} canEdit={canEdit} />)}
    </div>
  );
}

/**
 * Its own component for a reason: a useDroppable called in the component that *renders* the
 * DndContext registers against whatever context is above it — i.e. nothing — and the drop is
 * silently ignored. Dropping onto a day worked while dropping here did nothing at all.
 */
function Unscheduled({ cards, onOpen, canEdit }: { cards: ViewCard[]; onOpen: (id: string) => void; canEdit: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${DAY_ID}none` });
  return (
    <div ref={setNodeRef} className={`calunscheduled${isOver ? " over" : ""}`}>
      <b>No due date</b> <span className="muted">{cards.length}</span>
      <div className="calunrow">
        {cards.map((c) => <CalCard key={c.id} card={c} onOpen={onOpen} canEdit={canEdit} />)}
      </div>
    </div>
  );
}

export function CalendarView({ cards, onOpen, canEdit, onSetDue }:
  Common & { canEdit: boolean; onSetDue: (cardId: string, day: string | null) => void }) {
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const weeks = useMemo(() => monthGrid(cursor.y, cursor.m), [cursor]);
  // dnd-kit, like the board itself: the same pointer feel, it works on touch, and an observer who
  // cannot write gets no drag sensor at all rather than a card that snaps back. The sensor is created
  // unconditionally — a hook behind an `if` is a hook that breaks the moment the condition changes.
  const pointer = useSensor(PointerSensor, { activationConstraint: { distance: 5 } });
  const sensors = useSensors(...(canEdit ? [pointer] : []));

  const byDay = useMemo(() => {
    const map: Record<string, ViewCard[]> = {};
    for (const c of cards) if (c.dueDate) (map[cardDayKey(c.dueDate)] ||= []).push(c);
    return map;
  }, [cards]);
  const undated = cards.filter((c) => !c.dueDate);
  const todayKey = dayKey(today);   // today's cell is a local day, like every other cell

  const onDragEnd = (e: DragEndEvent) => {
    const over = String(e.over?.id ?? "");
    if (!over.startsWith(DAY_ID)) return;
    const day = over.slice(DAY_ID.length);
    const card = cards.find((c) => c.id === String(e.active.id));
    const wanted = day === "none" ? null : day;
    // Dropping a card back where it already sits is not a change worth a request.
    if (card && (card.dueDate ? cardDayKey(card.dueDate) : null) !== wanted) onSetDue(String(e.active.id), wanted);
  };

  return (
    <DndContext id="calendar-dnd" sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
      <div className="calendar">
        <div className="calhead">
          <button className="mini" onClick={() => setCursor(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))}
            aria-label="Previous month">←</button>
          <b>{MONTHS[cursor.m]} {cursor.y}</b>
          <button className="mini" onClick={() => setCursor(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))}
            aria-label="Next month">→</button>
          <button className="mini" onClick={() => setCursor({ y: today.getFullYear(), m: today.getMonth() })}>Today</button>
          {canEdit && <span className="muted">drag a card to change its due date</span>}
        </div>
        <div className="calgrid">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="caldow">{d}</div>)}
          {weeks.flat().map((day) => (
            <DayCell key={day.key} day={day} cards={byDay[day.key] || []} onOpen={onOpen}
              canEdit={canEdit} isToday={day.key === todayKey} />
          ))}
        </div>
        <Unscheduled cards={undated} onOpen={onOpen} canEdit={canEdit} />
      </div>
    </DndContext>
  );
}

/* --------------------------------------------------------------- timeline */

export function TimelineView({ cards, onOpen }: Common) {
  const dated = cards.filter((c) => c.startDate || c.dueDate);
  const span = useMemo(() => timelineSpan(dated), [dated]);
  const rows = useMemo(() => sortCards(dated, "dueDate", "asc"), [dated]);
  const undated = cards.filter((c) => !c.startDate && !c.dueDate);

  if (!span) return <div className="bempty">No card has a start or due date yet, so there is nothing to lay out.</div>;

  // One tick per month the span covers, which is honest at any zoom without pretending to be precise.
  const ticks: { label: string; left: number }[] = [];
  const total = Math.max(span.end.getTime() - span.start.getTime(), 86400000);
  for (let d = new Date(span.start.getFullYear(), span.start.getMonth(), 1);
    d <= span.end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const left = ((d.getTime() - span.start.getTime()) / total) * 100;
    if (left >= 0 && left <= 100) ticks.push({ label: `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`, left });
  }

  return (
    <div className="timeline">
      <div className="tlhead">
        <span className="muted">{fmtDue(span.start)} – {fmtDue(span.end)}</span>
        <div className="tlticks">
          {ticks.map((t) => <span key={t.label} className="tltick" style={{ left: `${t.left}%` }}>{t.label}</span>)}
        </div>
      </div>
      {rows.map((c) => {
        const bar = barFor(c, span)!;
        return (
          <div key={c.id} className="tlrow" onClick={() => onOpen(c.id)}>
            <div className="tlname">
              <span className={`itype ${c.issueType || "task"}`}>{TYPE_MARK[c.issueType || "task"]}</span>
              {c.issueKey && <span className="ikey">{c.issueKey}</span>} {c.title}
            </div>
            <div className="tltrack">
              <div className={`tlbar ${c.isComplete ? "done" : c.issueType || "task"}`}
                style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                title={`${c.startDate ? fmtDue(c.startDate) : "?"} → ${c.dueDate ? fmtDue(c.dueDate) : "?"}`} />
            </div>
          </div>
        );
      })}
      {undated.length > 0 && (
        <div className="bempty">{undated.length} card{undated.length === 1 ? "" : "s"} have no dates and are not shown.</div>
      )}
    </div>
  );
}
