/**
 * Swimlanes: horizontal rows across the columns, grouped by epic, assignee, priority or type — the
 * groupings Jira offers. Pure so the board can group without another request.
 *
 * Empty lanes are dropped except the catch-all ("No epic" / "Unassigned"), which is kept when it has
 * cards and always sorts last: it is a reminder, not a priority.
 */
export type GroupBy = "none" | "epic" | "assignee" | "priority" | "type";

type LaneCard = {
  id: string;
  parentId?: string | null;
  assigneeId?: string | null;
  assignee?: { id: string; name: string } | null;
  priority?: string;
  issueType?: string;
};

export type Lane<T> = { key: string; label: string; cards: T[] };

const PRIORITY_ORDER = ["highest", "high", "medium", "low", "lowest"];
const TYPE_ORDER = ["epic", "story", "task", "bug", "subtask"];
const NONE = "__none__";

export function laneKeyOf(card: LaneCard, groupBy: GroupBy): string {
  switch (groupBy) {
    case "epic": return card.parentId ?? NONE;
    case "assignee": return card.assigneeId ?? NONE;
    case "priority": return card.priority ?? "medium";
    case "type": return card.issueType ?? "task";
    default: return NONE;
  }
}

export function lanesFor<T extends LaneCard>(
  cards: T[],
  groupBy: GroupBy,
  names: { parents?: Record<string, string>; people?: Record<string, string> } = {},
): Lane<T>[] {
  if (groupBy === "none") return [{ key: NONE, label: "", cards }];

  const byKey = new Map<string, T[]>();
  for (const c of cards) {
    const k = laneKeyOf(c, groupBy);
    byKey.set(k, [...(byKey.get(k) ?? []), c]);
  }

  const label = (key: string): string => {
    if (key === NONE) return groupBy === "epic" ? "No epic" : "Unassigned";
    if (groupBy === "epic") return names.parents?.[key] ?? "Epic";
    if (groupBy === "assignee") return names.people?.[key] ?? "Someone";
    return key.replace(/_/g, " ");
  };

  const keys = [...byKey.keys()];
  const fixed = groupBy === "priority" ? PRIORITY_ORDER : groupBy === "type" ? TYPE_ORDER : null;
  keys.sort((a, b) => {
    if (a === NONE) return 1;          // catch-all last
    if (b === NONE) return -1;
    if (fixed) return fixed.indexOf(a) - fixed.indexOf(b);
    return label(a).localeCompare(label(b));
  });

  // With a fixed order (priority, type) show every value that has cards; the rest come from the data
  // anyway, so an empty lane never appears.
  return keys.map((key) => ({ key, label: label(key), cards: byKey.get(key) ?? [] }));
}
