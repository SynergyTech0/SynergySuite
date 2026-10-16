/**
 * Read a Jira CSV export into the same shape as a Trello import, so one importer serves both.
 *
 * Jira's CSV is generous with its column names ("Issue Type" / "Issue type", "Story Points" /
 * "Custom field (Story Points)") and repeats a column per value for multi-valued fields such as
 * Labels — parseCsv joins those back together. One list is created per Status, in the order the
 * statuses first appear, which puts the board in roughly the order the exporter had it.
 */
import { parseCsv } from "./csv";
import type { ImportBoard, ImportCard, ImportList, IssueType, Priority } from "./import-trello";

const TYPES: Record<string, IssueType> = {
  story: "story", bug: "bug", task: "task", "sub-task": "subtask", subtask: "subtask", epic: "epic",
  improvement: "task", "new feature": "story",
};
const PRIORITIES: Priority[] = ["highest", "high", "medium", "low", "lowest"];
const asPriority = (v: string): Priority => PRIORITIES.find((p) => p === v.toLowerCase()) ?? "medium";

/** Jira's header spellings vary by version and export; match on a normalised name. */
function pick(row: Record<string, string>, ...names: string[]): string {
  const keys = Object.keys(row);
  for (const want of names) {
    const hit = keys.find((k) => k.trim().toLowerCase() === want || k.trim().toLowerCase().endsWith(`(${want})`));
    if (hit && row[hit]) return row[hit];
  }
  return "";
}

export function readJiraCsv(text: string, boardTitle = "Imported from Jira"): ImportBoard {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("That CSV has no rows.");
  if (!Object.keys(rows[0]).some((k) => k.trim().toLowerCase() === "summary")) {
    throw new Error("That CSV has no Summary column, so there are no issue titles to import.");
  }

  const byStatus = new Map<string, ImportCard[]>();
  const labels = new Map<string, { name: string; color: string }>();
  let dropped = 0;

  for (const row of rows) {
    const title = pick(row, "summary");
    if (!title) { dropped++; continue; }
    const status = pick(row, "status") || "To Do";
    const points = pick(row, "story points", "story point estimate");
    const cardLabels = pick(row, "labels").split(",").map((s) => s.trim()).filter(Boolean);
    for (const l of cardLabels) if (!labels.has(l)) labels.set(l, { name: l, color: "#5b8cff" });

    const cards = byStatus.get(status) ?? [];
    cards.push({
      title,
      description: pick(row, "description"),
      position: (cards.length + 1) * 1024,
      dueDate: pick(row, "due date") || null,
      isComplete: /^(done|closed|resolved)$/i.test(status),
      labels: cardLabels,
      checklists: [],
      comments: [],
      // Jira-only fields, carried alongside the Trello-shaped ones.
      issueType: TYPES[pick(row, "issue type").toLowerCase()] ?? "task",
      priority: asPriority(pick(row, "priority")),
      points: points && !Number.isNaN(Number(points)) ? Math.round(Number(points)) : null,
      assignee: pick(row, "assignee") || null,
    });
    byStatus.set(status, cards);
  }

  const lists: ImportList[] = [...byStatus.entries()].map(([title, cards], i) => ({
    title, position: (i + 1) * 1024, cards,
  }));

  const skipped: string[] = [];
  if (dropped) skipped.push(`${dropped} row${dropped === 1 ? "" : "s"} with no summary`);
  // Said out loud rather than silently ignored: these are the columns people ask about afterwards.
  skipped.push("assignees are recorded on the card as text — invite people and assign them here");
  skipped.push("comments, attachments and issue links are not in a Jira CSV export");

  return { title: boardTitle, labels: [...labels.values()], lists, skipped };
}
