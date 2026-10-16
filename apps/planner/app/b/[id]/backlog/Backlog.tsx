"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
} from "@dnd-kit/core";
import { CardModal } from "../CardModal";
import { afterLast } from "@/lib/position";

// Dates arrive as Date objects from the server component and as ISO strings from the JSON refetch —
// both parse through new Date(), so accept either rather than serialising at every boundary.
type Stamp = string | Date | null;
type Card = {
  id: string; title: string; issueKey?: string | null; issueType?: string; priority?: string;
  points?: number | null; sprintId?: string | null; parentId?: string | null;
  position?: number; isComplete: boolean; completedAt?: Stamp;
};
type Sprint = {
  id: string; name: string; goal?: string | null; state: "future" | "active" | "completed";
  startDate?: Stamp; endDate?: Stamp;
};
type Board = { id: string; title: string };

const TYPE_MARK: Record<string, string> = { epic: "E", story: "S", task: "T", bug: "B", subtask: "·" };
const PRIO_MARK: Record<string, string> = { highest: "⤒", high: "↑", medium: "=", low: "↓", lowest: "⤓" };
const DAY = 86400000;

const pts = (cs: Card[]) => cs.reduce((s, c) => s + (c.points || 0), 0);
const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * A real burndown, computed from cards' completedAt timestamps — not a synthetic curve. The actual
 * line is only drawn up to today (you can't know the future), while the ideal line spans the whole
 * sprint. Returns null when there's nothing meaningful to plot.
 */
function burndown(sprint: Sprint, cs: Card[]) {
  if (!sprint.startDate) return null;
  const committed = pts(cs);
  if (committed === 0) return null;

  const d0 = new Date(sprint.startDate); d0.setHours(0, 0, 0, 0);
  const end = sprint.endDate ? new Date(sprint.endDate) : new Date(d0.getTime() + 14 * DAY);
  end.setHours(23, 59, 59, 999);
  const total = Math.max(1, Math.round((end.getTime() - d0.getTime()) / DAY));
  const now = Date.now();

  const pointsSeries: { i: number; ideal: number; actual: number | null }[] = [];
  for (let i = 0; i <= total; i++) {
    const cutoff = d0.getTime() + i * DAY + (DAY - 1);
    const burned = cs
      .filter((c) => c.isComplete && c.completedAt && new Date(c.completedAt).getTime() <= cutoff)
      .reduce((s, c) => s + (c.points || 0), 0);
    pointsSeries.push({
      i,
      ideal: committed - (committed * i) / total,
      actual: cutoff - (DAY - 1) <= now ? committed - burned : null,
    });
  }
  return { committed, total, series: pointsSeries, d0, end };
}

function Burndown({ sprint, cards }: { sprint: Sprint; cards: Card[] }) {
  const b = burndown(sprint, cards);
  if (!b) {
    return (
      <div className="bdnote">
        {!sprint.startDate
          ? "Start the sprint to begin the burndown."
          : "No story points estimated — burndown needs points on the cards."}
      </div>
    );
  }
  const W = 420, H = 130, PADX = 34, PADY = 12;
  const x = (i: number) => PADX + (i / b.total) * (W - PADX - 10);
  const y = (v: number) => PADY + (1 - v / b.committed) * (H - PADY - 20);

  const ideal = b.series.map((p) => `${x(p.i)},${y(p.ideal)}`).join(" ");
  const actual = b.series.filter((p) => p.actual !== null)
    .map((p) => `${x(p.i)},${y(p.actual as number)}`).join(" ");
  const last = [...b.series].reverse().find((p) => p.actual !== null);
  const remaining = last ? (last.actual as number) : b.committed;
  const ahead = last ? (last.actual as number) <= last.ideal : true;

  return (
    <div className="bd">
      <svg viewBox={`0 0 ${W} ${H}`} className="bdsvg" role="img" aria-label="Sprint burndown">
        <line x1={PADX} y1={y(0)} x2={W - 10} y2={y(0)} className="bdaxis" />
        <line x1={PADX} y1={PADY} x2={PADX} y2={y(0)} className="bdaxis" />
        <text x={4} y={y(b.committed) + 4} className="bdlab">{b.committed}</text>
        <text x={12} y={y(0) + 4} className="bdlab">0</text>
        <polyline points={ideal} className="bdideal" />
        {actual && <polyline points={actual} className={`bdactual ${ahead ? "ok" : "behind"}`} />}
        {last && <circle cx={x(last.i)} cy={y(last.actual as number)} r={3.5}
                         className={`bddot ${ahead ? "ok" : "behind"}`} />}
        <text x={PADX} y={H - 4} className="bdlab">{fmtDay(b.d0)}</text>
        <text x={W - 52} y={H - 4} className="bdlab">{fmtDay(b.end)}</text>
      </svg>
      <div className="bdmeta">
        <b>{remaining}</b> of {b.committed} pts remaining
        <span className={ahead ? "ok" : "behind"}>{ahead ? "on track" : "behind ideal"}</span>
      </div>
    </div>
  );
}

function Row({ card, onOpen }: { card: Card; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id });
  const down = useRef<{ x: number; y: number } | null>(null);
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`brow ${isDragging ? "drag" : ""} ${card.isComplete ? "done" : ""}`}
      onPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY }; (listeners as any)?.onPointerDown?.(e); }}
      onPointerUp={(e) => {
        // dnd-kit swallows click; treat a near-stationary pointer as a click.
        const d = down.current;
        if (d && Math.abs(e.clientX - d.x) < 5 && Math.abs(e.clientY - d.y) < 5) onOpen(card.id);
        down.current = null;
      }}
    >
      <span className={`itype ${card.issueType || "task"}`}>{TYPE_MARK[card.issueType || "task"]}</span>
      {card.issueKey && <span className="ikey">{card.issueKey}</span>}
      <span className="btitle">{card.title}</span>
      <span className={`prio ${card.priority || "medium"}`}>{PRIO_MARK[card.priority || "medium"]}</span>
      {card.points != null && <span className="pts">{card.points}</span>}
    </div>
  );
}

function Zone({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={`bzone ${isOver ? "over" : ""}`}>{children}</div>;
}

export function Backlog({ board, initialSprints, initialCards, canEdit = true }:
  { board: Board; initialSprints: Sprint[]; initialCards: Card[]; canEdit?: boolean }) {
  const [sprints, setSprints] = useState<Sprint[]>(initialSprints as Sprint[]);
  const [cards, setCards] = useState<Card[]>(initialCards as Card[]);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<Card | null>(null);
  const dragging = useRef(false);
  const pointer = useSensor(PointerSensor, { activationConstraint: { distance: 5 } });
  const sensors = useSensors(...(canEdit ? [pointer] : []));

  const refetch = useCallback(async () => {
    const r = await fetch(`/api/boards/${board.id}`);
    if (!r.ok) return;
    const d = await r.json();
    setSprints(d.sprints || []);
    setCards(d.cards || []);
  }, [board.id]);

  useEffect(() => {
    const es = new EventSource(`/api/stream/${board.id}`);
    es.onmessage = () => { if (!dragging.current) refetch(); };
    return () => es.close();
  }, [board.id, refetch]);

  // Stable identity: CardModal reloads when onClose changes, and this view re-renders on every live refetch.
  const closeCard = useCallback(() => { setOpen(null); refetch(); }, [refetch]);

  const inSprint = (id: string) => cards.filter((c) => c.sprintId === id);
  const backlog = cards.filter((c) => !c.sprintId);

  async function move(cardId: string, sprintId: string | null) {
    // Give the card a position at the end of the zone it lands in. Without this the card keeps
    // whatever position it inherited from its board column, so sprint and backlog order is
    // arbitrary and shuffles on every refetch — the board view computes a position on drop, and
    // this view has to do the same or the ordering it shows is not the ordering that persists.
    const destination = cards.filter((c) => (c.sprintId ?? null) === sprintId && c.id !== cardId);
    const position = afterLast(destination.map((c) => c.position ?? 0));

    setCards((cs) => cs.map((c) => (c.id === cardId ? { ...c, sprintId, position } : c)));   // optimistic
    await fetch(`/api/cards/${cardId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sprintId, position }),
    });
    refetch();
  }

  function onDragEnd(e: DragEndEvent) {
    dragging.current = false;
    setActive(null);
    const over = e.over?.id?.toString();
    if (!over) return;
    const target = over === "backlog" ? null : over.replace("sprint:", "");
    const card = cards.find((c) => c.id === e.active.id);
    if (!card || (card.sprintId ?? null) === target) return;
    move(card.id, target);
  }

  async function createSprint() {
    const name = prompt("Sprint name:", `Sprint ${sprints.length + 1}`);
    if (!name) return;
    await fetch("/api/sprints", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ boardId: board.id, name }),
    });
    refetch();
  }

  async function setState(s: Sprint, state: string) {
    if (state === "completed" && !confirm(`Complete "${s.name}"? Unfinished cards return to the backlog.`)) return;
    const r = await fetch(`/api/sprints/${s.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    const d = await r.json();
    if (!r.ok) { setErr(d.error || "Could not change sprint state"); return; }
    setErr(null);
    if (state === "completed" && d.returnedToBacklog > 0) {
      setErr(`${d.returnedToBacklog} unfinished card${d.returnedToBacklog > 1 ? "s" : ""} returned to the backlog.`);
    }
    refetch();
  }

  async function delSprint(s: Sprint) {
    if (!confirm(`Delete "${s.name}"? Its cards return to the backlog.`)) return;
    await fetch(`/api/sprints/${s.id}`, { method: "DELETE" });
    refetch();
  }

  const order = { active: 0, future: 1, completed: 2 } as Record<string, number>;
  const sorted = [...sprints].sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9));

  return (
    <div className="boardpage">
      <div className="boardhead">
        <a href="/" className="back">← Boards</a>
        <a href={`/b/${board.id}`} className="back">Board</a>
        <div className="h1">{board.title} · Backlog</div>
        <div style={{ flex: 1 }} />
        {canEdit ? <button className="btn" onClick={createSprint}>+ Sprint</button>
          : <span className="spill" title="You can view this board but not change it">read-only</span>}
      </div>

      {err && <div className="bnote" onClick={() => setErr(null)}>{err} <span className="mini">dismiss</span></div>}

      <DndContext id="backlog-dnd"
        sensors={sensors}
        onDragStart={(e: DragStartEvent) => {
          dragging.current = true;
          setActive(cards.find((c) => c.id === e.active.id) || null);
        }}
        onDragEnd={onDragEnd}
        onDragCancel={() => { dragging.current = false; setActive(null); }}
      >
        <div className="backlog">
          {sorted.map((s) => {
            const cs = inSprint(s.id);
            const done = cs.filter((c) => c.isComplete);
            const unpointed = cs.filter((c) => c.points == null).length;
            return (
              <section key={s.id} className={`sprint ${s.state}`}>
                <div className="shead">
                  <span className={`spill ${s.state}`}>{s.state}</span>
                  <b>{s.name}</b>
                  <span className="muted">
                    {cs.length} issue{cs.length === 1 ? "" : "s"} · {pts(done)}/{pts(cs)} pts
                    {unpointed > 0 && <> · <span className="warn">{unpointed} unestimated</span></>}
                  </span>
                  <div style={{ flex: 1 }} />
                  {canEdit && s.state === "future" && <button className="mini" onClick={() => setState(s, "active")}>Start</button>}
                  {canEdit && s.state === "active" && <button className="mini" onClick={() => setState(s, "completed")}>Complete</button>}
                  {canEdit && <button className="mini" onClick={() => delSprint(s)}>✕</button>}
                </div>

                {s.state === "active" && <Burndown sprint={s} cards={cs} />}

                <Zone id={`sprint:${s.id}`}>
                  {cs.length === 0
                    ? <div className="bempty">Drag issues here to plan this sprint.</div>
                    : cs.map((c) => <Row key={c.id} card={c} onOpen={setOpen} />)}
                </Zone>
              </section>
            );
          })}

          <section className="sprint backlogsec">
            <div className="shead">
              <span className="spill backlog">backlog</span>
              <span className="muted">{backlog.length} issues · {pts(backlog)} pts</span>
            </div>
            <Zone id="backlog">
              {backlog.length === 0
                ? <div className="bempty">Backlog is empty.</div>
                : backlog.map((c) => <Row key={c.id} card={c} onOpen={setOpen} />)}
            </Zone>
          </section>
        </div>

        <DragOverlay>{active ? <div className="brow drag">{active.title}</div> : null}</DragOverlay>
      </DndContext>

      {open && (
        <CardModal
          cardId={open}
          boardId={board.id}
          canEdit={canEdit}
          onClose={closeCard}
          onChange={() => refetch()}
        />
      )}
    </div>
  );
}
