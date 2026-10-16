"use client";
import { useEffect, useState } from "react";
import { dueState, shortDate } from "@/lib/due";

/**
 * The dashboard: what is mine, what is late, and where each board stands.
 *
 * Deliberately one screen with no controls. A dashboard people have to configure is a dashboard
 * people do not read, and everything here is already filterable on the board itself or in search.
 */

type Assigned = {
  id: string; title: string; issueKey: string | null; issueType: string; priority: string;
  points: number | null; dueDate: string | null; boardId: string; boardTitle: string; listTitle: string;
};
type BoardCount = { id: string; title: string; keyPrefix: string; open: number; done: number };
type Work = { assigned: Assigned[]; overdue: number; dueSoon: number; boards: BoardCount[] };

const TYPE_MARK: Record<string, string> = { epic: "E", story: "S", task: "T", bug: "B", subtask: "·" };
const PRIO_MARK: Record<string, string> = { highest: "⤒", high: "↑", medium: "=", low: "↓", lowest: "⤓" };

export function MyWork() {
  const [work, setWork] = useState<Work | null>(null);

  useEffect(() => {
    fetch("/api/my-work").then((r) => (r.ok ? r.json() : null)).then(setWork);
  }, []);

  if (!work) return <div className="wrap"><div className="h1">My work</div><div className="bempty">Loading…</div></div>;

  const totals = work.boards.reduce((t, b) => ({ open: t.open + b.open, done: t.done + b.done }), { open: 0, done: 0 });

  return (
    <div className="wrap">
      <div className="h1">My work</div>

      <div className="statrow">
        <div className="stat"><b>{work.assigned.length}</b><span>assigned to me</span></div>
        <div className={`stat${work.overdue ? " bad" : ""}`}><b>{work.overdue}</b><span>overdue</span></div>
        <div className="stat"><b>{work.dueSoon}</b><span>due this week</span></div>
        <div className="stat"><b>{totals.open}</b><span>open across {work.boards.length} board{work.boards.length === 1 ? "" : "s"}</span></div>
      </div>

      <div className="mlabel">Assigned to me</div>
      <div className="searchresults" style={{ marginBottom: 18 }}>
        {work.assigned.map((c) => {
          const state = dueState(c.dueDate, false);
          return (
            <a key={c.id} className="brow" href={`/b/${c.boardId}?card=${c.id}`}>
              <span className={`itype ${c.issueType}`}>{TYPE_MARK[c.issueType] ?? "T"}</span>
              {c.issueKey && <span className="ikey">{c.issueKey}</span>}
              <span className="btitle">{c.title}</span>
              <span className="muted">{c.boardTitle} · {c.listTitle}</span>
              <span className={`prio ${c.priority}`}>{PRIO_MARK[c.priority]}</span>
              {c.points != null && <span className="pts">{c.points}</span>}
              {c.dueDate && (
                <span className={`duechip ${state === "overdue" ? "overdue" : state === "soon" ? "soon" : ""}`}>
                  {shortDate(c.dueDate)}
                </span>
              )}
            </a>
          );
        })}
        {!work.assigned.length && <div className="bempty">Nothing is assigned to you. Quiet, or suspicious.</div>}
      </div>

      <div className="mlabel">Boards</div>
      <div className="searchresults">
        {work.boards.map((b) => {
          const total = b.open + b.done;
          return (
            <a key={b.id} className="brow" href={`/b/${b.id}`}>
              <span className="ikey">{b.keyPrefix}</span>
              <span className="btitle">{b.title}</span>
              {/* The bar is the only chart here: done out of everything, no axis needed. */}
              <span className="progress" title={`${b.done} of ${total} complete`}>
                <span style={{ width: `${total ? (b.done / total) * 100 : 0}%` }} />
              </span>
              <span className="muted">{b.done}/{total} done</span>
            </a>
          );
        })}
        {!work.boards.length && <div className="bempty">No boards yet.</div>}
      </div>
    </div>
  );
}
