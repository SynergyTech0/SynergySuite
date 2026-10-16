/**
 * Turn an activity row into the sentence a person reads: "moved this from To Do to Done". Pure and
 * client-safe; the card view says "this card", the board feed names the card.
 */
export type ActivityRow = {
  id: string;
  type: string;
  data: Record<string, unknown> | null;
  createdAt: string | Date;
  cardId?: string | null;
  actor?: string | null;
  actorIsMind?: boolean | null;
  cardTitle?: string | null;
  issueKey?: string | null;
};

const q = (v: unknown) => `“${String(v)}”`;
const day = (v: unknown) =>
  v ? new Date(String(v)).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;

const FIELD_NAMES: Record<string, string> = {
  issueType: "type", priority: "priority", points: "story points", title: "title",
};

export function describeActivity(a: ActivityRow, where: "card" | "board" = "card"): string {
  const d = a.data ?? {};
  const it = where === "card" ? "this card" : a.issueKey ?? (a.cardTitle ? q(a.cardTitle) : "a card");

  switch (a.type) {
    case "card_created": return d.copiedFrom ? `created ${it} as a copy of ${d.copiedFrom}` : `created ${it}`;
    case "card_moved":
      if (d.toBoard) return `moved ${it} from board ${q(d.fromBoard ?? "?")} to ${q(d.toBoard)}${d.previousKey ? ` (was ${d.previousKey})` : ""}`;
      return `moved ${it} from ${d.from ?? "?"} to ${d.to ?? "?"}`;
    case "card_archived": return `archived ${it}`;
    case "card_restored": return `restored ${it}`;
    case "card_deleted": return `deleted ${d.issueKey ? `${d.issueKey} ` : ""}${q(d.title ?? "a card")}`;
    case "due_changed":
      return d.to ? `set the due date of ${it} to ${day(d.to)}` : `removed the due date from ${it}`;
    case "comment_added": return `commented on ${it}: ${q(d.excerpt ?? "")}`;
    case "comment_edited": return `edited a comment on ${it}`;
    case "comment_deleted": return `deleted a comment on ${it}`;
    case "label_added": return `added the ${d.name ? q(d.name) : "colour"} label to ${it}`;
    case "label_removed": return `removed the ${d.name ? q(d.name) : "colour"} label from ${it}`;
    case "member_added": return `assigned ${d.name ?? "someone"} to ${it}`;
    case "member_removed": return `unassigned ${d.name ?? "someone"} from ${it}`;
    case "checklist_added": return `added checklist ${q(d.title ?? "")} to ${it}`;
    case "checklist_updated":
      if (d.deleted) return `removed checklist ${q(d.checklist ?? "")} from ${it}`;
      return `${d.checked ? "completed" : "unchecked"} ${q(d.item ?? "")} on ${it}`;
    case "link_added": return `linked ${it}: ${d.label ?? "relates to"} ${d.other ?? "another card"}`;
    case "link_removed": return `removed the link “${d.label ?? ""} ${d.other ?? ""}” from ${it}`;
    case "attachment_added": return `attached ${q(d.name ?? "a file")} to ${it}`;
    case "attachment_removed": return `removed attachment ${q(d.name ?? "")} from ${it}`;
    case "list_created": return `added list ${q(d.title ?? "")}`;
    case "list_archived": return `${d.deleted ? "deleted" : "archived"} list ${q(d.title ?? "")}`;
    case "list_updated":
      return d.field === "restored" ? `restored list ${q(d.title ?? "")}` : `renamed list ${q(d.from ?? "")} to ${q(d.to ?? "")}`;
    case "sprint_started": return `started sprint ${q(d.name ?? "")}`;
    case "sprint_completed": {
      const n = Number(d.returnedToBacklog || 0);
      return `completed sprint ${q(d.name ?? "")}${n ? ` (${n} unfinished returned to backlog)` : ""}`;
    }
    // The rule's name and what it did are both recorded, so the feed can say which rule ran rather
    // than leaving someone to guess why a card changed on its own.
    case "automation_ran":
      return d.rule ? `rule ${q(String(d.rule))} ${d.did ?? "ran"} on ${it}` : `ran an automation on ${it}`;
    case "card_updated": {
      const field = String(d.field ?? "");
      if (field === "description") return `updated the description of ${it}`;
      if (field === "isComplete") return d.to ? `marked ${it} complete` : `marked ${it} incomplete`;
      if (field === "sprint") {
        if (d.to && d.from) return `moved ${it} from sprint ${q(d.from)} to ${q(d.to)}`;
        return d.to ? `added ${it} to sprint ${q(d.to)}` : `moved ${it} from sprint ${q(d.from)} to the backlog`;
      }
      if (field === "parent") return d.to ? `set the parent of ${it} to ${d.to}` : `removed the parent of ${it}`;
      if (field === "worklog") {
        if (d.removed) return `removed ${d.removed} minutes of logged work from ${it}`;
        return `logged ${d.logged} minutes on ${it}`;
      }
      if (field === "fix version") return d.added ? `added ${it} to a fix version` : `removed ${it} from a fix version`;
      if (field === "component") return d.added ? `added a component to ${it}` : `removed a component from ${it}`;
      if (field === "startDate") return d.to ? `set the start date of ${it} to ${day(d.to)}` : `removed the start date from ${it}`;
      if (field === "points" && d.to == null) return `cleared the story points of ${it}`;
      if (field === "title") return `renamed ${it} from ${q(d.from ?? "")} to ${q(d.to ?? "")}`;
      const name = FIELD_NAMES[field] ?? field;
      return d.from == null ? `set the ${name} of ${it} to ${d.to}` : `changed the ${name} of ${it} from ${d.from} to ${d.to}`;
    }
    default: return `${a.type.replace(/_/g, " ")} on ${it}`;
  }
}

export function relativeTime(v: string | Date, now = Date.now()): string {
  const t = new Date(v).getTime();
  const s = Math.round((now - t) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d ago`;
  return new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
