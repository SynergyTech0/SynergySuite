/**
 * Read a Trello board export (Menu → More → Print and export → Export as JSON).
 *
 * The export is large and mostly history; this takes the parts that have somewhere to go here and
 * says plainly, in the import summary, what it left behind. Members are deliberately dropped: Trello
 * ids mean nothing on this instance, and inventing users from an import is how a tenancy boundary
 * gets quietly crossed. Comments are kept as text with the original author's name in the body,
 * which is honest about the fact that they are imported rather than written here.
 */

import type { cards } from "@/db/schema";

type CardInsert = typeof cards.$inferInsert;
export type IssueType = NonNullable<CardInsert["issueType"]>;
export type Priority = NonNullable<CardInsert["priority"]>;

export type ImportChecklist = { title: string; items: { title: string; isDone: boolean }[] };
export type ImportComment = { author: string; text: string; at: string };
export type ImportCard = {
  title: string; description: string; position: number;
  dueDate: string | null; isComplete: boolean;
  labels: string[]; checklists: ImportChecklist[]; comments: ImportComment[];
  // Jira has these and Trello does not; a Trello import simply leaves them unset.
  issueType?: IssueType; priority?: Priority; points?: number | null; assignee?: string | null;
};
export type ImportList = { title: string; position: number; cards: ImportCard[] };
export type ImportBoard = {
  title: string;
  labels: { name: string; color: string }[];
  lists: ImportList[];
  skipped: string[];
};

// Trello's palette names → the hexes this app uses for labels.
const TRELLO_COLORS: Record<string, string> = {
  green: "#61bd4f", yellow: "#f2d600", orange: "#ff9f1a", red: "#eb5a46", purple: "#c377e0",
  blue: "#0079bf", sky: "#00c2e0", lime: "#51e898", pink: "#ff78cb", black: "#344563",
};
const hexFor = (color: string | null | undefined) => TRELLO_COLORS[String(color).split("_")[0]] ?? "#5b8cff";

type Json = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

export function readTrelloExport(text: string): ImportBoard {
  let raw: Json;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file could not be read as JSON. Export the board again with Trello's “Export as JSON”.");
  }
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.lists) || !Array.isArray(raw.cards)) {
    throw new Error("That does not look like a Trello board export — it has no lists or cards.");
  }

  const skipped: string[] = [];
  // A label with no name is still meaningful in Trello (people use the colour), so keep the colour
  // as the name rather than importing something blank that nobody can select.
  const labels = (raw.labels ?? []).map((l: Json) => ({ name: String(l.name || l.color || "label"), color: hexFor(l.color) }));
  const labelName = new Map<string, string>((raw.labels ?? []).map((l: Json) => [l.id, String(l.name || l.color || "label")]));

  const checklistsByCard = new Map<string, ImportChecklist[]>();
  for (const k of raw.checklists ?? []) {
    const items = (k.checkItems ?? [])
      .slice()
      .sort((a: Json, b: Json) => (a.pos ?? 0) - (b.pos ?? 0))
      .map((i: Json) => ({ title: String(i.name ?? ""), isDone: i.state === "complete" }));
    const list = checklistsByCard.get(k.idCard) ?? [];
    list.push({ title: String(k.name ?? "Checklist"), items });
    checklistsByCard.set(k.idCard, list);
  }

  const commentsByCard = new Map<string, ImportComment[]>();
  for (const a of raw.actions ?? []) {
    if (a.type !== "commentCard" || !a.data?.card?.id) continue;
    const list = commentsByCard.get(a.data.card.id) ?? [];
    list.push({
      author: String(a.memberCreator?.fullName ?? a.memberCreator?.username ?? "someone"),
      text: String(a.data.text ?? ""),
      at: String(a.date ?? ""),
    });
    commentsByCard.set(a.data.card.id, list);
  }

  const closedLists = (raw.lists as Json[]).filter((l) => l.closed).length;
  const archivedCards = (raw.cards as Json[]).filter((c) => c.closed).length;
  if (closedLists) skipped.push(`${closedLists} archived list${closedLists === 1 ? "" : "s"}`);
  if (archivedCards) skipped.push(`${archivedCards} archived card${archivedCards === 1 ? "" : "s"}`);
  if ((raw.members ?? []).length) skipped.push(`${raw.members.length} member${raw.members.length === 1 ? "" : "s"} (invite them here instead)`);
  const attachments = (raw.cards as Json[]).reduce((n, c) => n + (c.attachments?.length ?? 0), 0);
  if (attachments) skipped.push(`${attachments} attachment${attachments === 1 ? "" : "s"}`);

  const lists: ImportList[] = (raw.lists as Json[])
    .filter((l) => !l.closed)
    .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))
    .map((l, i) => ({
      title: String(l.name ?? "List"),
      position: (i + 1) * 1024,
      cards: (raw.cards as Json[])
        .filter((c) => !c.closed && c.idList === l.id)
        .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))
        .map((c, j) => ({
          title: String(c.name ?? "Card"),
          description: String(c.desc ?? ""),
          position: (j + 1) * 1024,
          dueDate: c.due ? String(c.due) : null,
          isComplete: !!c.dueComplete,
          labels: (c.idLabels ?? []).map((id: string) => labelName.get(id)).filter(Boolean) as string[],
          checklists: checklistsByCard.get(c.id) ?? [],
          comments: commentsByCard.get(c.id) ?? [],
        })),
    }));

  return { title: String(raw.name ?? "Imported board"), labels, lists, skipped };
}
