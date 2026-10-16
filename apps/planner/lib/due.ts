/**
 * Due-date state for badges, as Trello shows it: complete wins; past due is overdue; within the next
 * 24 hours is due soon. Dates are stored as timestamps from a date picker, so "due today" means any
 * time before the end of that day, not the midnight it was saved as.
 */
export type DueState = "complete" | "overdue" | "soon" | "later";

const DAY = 86400000;

export function dueState(due: string | Date | null | undefined, isComplete: boolean, now = Date.now()): DueState | null {
  if (!due) return null;
  if (isComplete) return "complete";
  const end = new Date(due).getTime() + DAY - 1; // end of the due day
  if (end < now) return "overdue";
  if (end - now <= DAY) return "soon";
  return "later";
}

export function dueLabel(s: DueState): string {
  return { complete: "Complete", overdue: "Overdue", soon: "Due soon", later: "Due" }[s];
}

export function shortDate(v: string | Date): string {
  return new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}
