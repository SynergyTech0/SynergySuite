/**
 * Maths for the table, calendar and timeline views, kept out of the components so it can be tested.
 *
 * Every sort here pushes missing values to the bottom in both directions: a card with no due date is
 * not "earliest" when sorting ascending and "latest" when sorting descending — it is simply unset,
 * and jumping between the ends of the table as the user flips direction is disorienting.
 */

export type SortKey = "issueKey" | "title" | "priority" | "points" | "dueDate" | "issueType" | "assignee" | "listId";
export type SortDir = "asc" | "desc";

const PRIORITY = ["highest", "high", "medium", "low", "lowest"];

type Sortable = {
  title?: string; issueKey?: string | null; priority?: string; points?: number | null;
  dueDate?: string | Date | null; issueType?: string;
  assignee?: { name: string } | null; listId?: string;
};

/** null when the card has nothing to sort by, so the caller can park it at the end. */
function valueOf(card: Sortable, key: SortKey): number | string | null {
  switch (key) {
    case "title": return (card.title || "").toLowerCase();
    // SYN-10 must follow SYN-2: compare the number, not the string.
    case "issueKey": return card.issueKey ? Number(card.issueKey.split("-").pop()) || 0 : null;
    case "priority": {
      const i = PRIORITY.indexOf(card.priority || "");
      return i === -1 ? null : i;
    }
    case "points": return card.points ?? null;
    case "dueDate": return card.dueDate ? new Date(card.dueDate).getTime() : null;
    case "issueType": return card.issueType || null;
    case "assignee": return card.assignee?.name.toLowerCase() ?? null;
    case "listId": return card.listId ?? null;
  }
}

export function sortCards<T extends Sortable>(cards: T[], key: SortKey, dir: SortDir = "asc"): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...cards].sort((a, b) => {
    const x = valueOf(a, key), y = valueOf(b, key);
    if (x === null && y === null) return 0;
    if (x === null) return 1;           // unset sinks, whichever way the column is pointing
    if (y === null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * sign;
  });
}

export type Day = { date: Date; inMonth: boolean; key: string };

/**
 * Whole Monday-first weeks covering `month` (0-based), padded with the neighbouring months' days.
 * Built in local time: a calendar cell is the day the user is looking at, and building it in UTC
 * puts every card a day early for anyone west of Greenwich.
 */
export function monthGrid(year: number, month: number): Day[][] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;                    // Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
  const weeks: Day[][] = [];
  for (let i = 0; i < cells; i++) {
    // Day arithmetic through the Date constructor, which rolls months and survives DST.
    const date = new Date(year, month, 1 - lead + i);
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push({
      date,
      inMonth: date.getMonth() === first.getMonth() && date.getFullYear() === first.getFullYear(),
      key: dayKey(date),
    });
  }
  return weeks;
}

/**
 * Two notions of "which day", deliberately kept apart.
 *
 * A calendar CELL is a local day — the date the user sees in the corner of the box. A card's due date
 * is stored as UTC midnight of the day the date picker offered, so it has to be read back in UTC;
 * reading it locally puts every card one day early west of Greenwich. Both produce the same
 * `YYYY-MM-DD` string for the day a human would name, which is what makes the lookup work.
 */
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function cardDayKey(when: string | Date): string {
  return new Date(when).toISOString().slice(0, 10);
}

type Dated = { startDate?: string | Date | null; dueDate?: string | Date | null };
export type Span = { start: Date; end: Date };

export function timelineSpan<T extends Dated>(cards: T[]): Span | null {
  const times = cards.flatMap((c) =>
    [c.startDate, c.dueDate].filter(Boolean).map((d) => new Date(d as string | Date).getTime()));
  if (!times.length) return null;
  return { start: new Date(Math.min(...times)), end: new Date(Math.max(...times)) };
}

/** Where a card's bar sits in the span, as percentages. A card with no dates at all gets no bar. */
export function barFor<T extends Dated>(card: T, span: Span): { left: number; width: number } | null {
  if (!card.startDate && !card.dueDate) return null;
  const total = Math.max(span.end.getTime() - span.start.getTime(), 86400000);
  const from = new Date((card.startDate ?? card.dueDate) as string | Date).getTime();
  const to = new Date((card.dueDate ?? card.startDate) as string | Date).getTime();
  const left = ((from - span.start.getTime()) / total) * 100;
  // A start and due on the same day would be a zero-width bar — invisible. Give it a sliver.
  const width = Math.max(((to - from) / total) * 100, 1.5);
  return { left: Math.max(0, Math.min(left, 100 - width)), width: Math.min(width, 100) };
}
