import { dueState } from "@/lib/due";

/**
 * Board filters (Trello's filter menu / Jira's quick filters), applied client-side to the snapshot.
 *
 * Within one facet the choices are OR ("label A or label B"); across facets they are AND ("label A,
 * and assigned to me"). That is how both Trello and Jira combine them, and it is the only combination
 * that narrows predictably as you add filters.
 */
export type CardFilter = {
  q: string;
  labels: string[];     // label ids
  members: string[];    // user ids, or "none" for unassigned
  due: ("overdue" | "soon" | "none" | "complete")[];
  types: string[];
  priorities: string[];
  versions: string[];   // fix version ids, or "none"
  components: string[]; // component ids, or "none"
  blocked: boolean;     // only cards an open issue blocks
  recent: boolean;      // only cards touched in the last 7 days
};

export const EMPTY_FILTER: CardFilter = {
  q: "", labels: [], members: [], due: [], types: [], priorities: [], versions: [], components: [], blocked: false, recent: false,
};

type FilterableCard = {
  title: string;
  issueKey?: string | null;
  description?: string | null;
  labels?: { id: string }[];
  members?: { id: string }[];
  assigneeId?: string | null;
  dueDate?: string | Date | null;
  isComplete?: boolean;
  issueType?: string;
  priority?: string;
  fixVersions?: { id: string }[];
  components?: { id: string }[];
  badges?: { blockedBy?: number };
  updatedAt?: string | Date | null;
};

export const isFiltering = (f: CardFilter) =>
  !!f.q.trim() || f.labels.length > 0 || f.members.length > 0 || f.due.length > 0 || f.types.length > 0 || f.priorities.length > 0 || f.versions.length > 0 || f.components.length > 0 || f.blocked || f.recent;

export function matchesFilter(card: FilterableCard, f: CardFilter, now = Date.now()): boolean {
  const q = f.q.trim().toLowerCase();
  if (q) {
    const hay = `${card.title} ${card.issueKey ?? ""} ${card.description ?? ""}`.toLowerCase();
    if (!q.split(/\s+/).every((word) => hay.includes(word))) return false;
  }
  if (f.labels.length && !(card.labels ?? []).some((l) => f.labels.includes(l.id))) return false;
  if (f.members.length) {
    // A person is "on" a card as a member or as its assignee; "none" means neither.
    const ids = [...(card.members ?? []).map((m) => m.id), ...(card.assigneeId ? [card.assigneeId] : [])];
    const hit = ids.some((id) => f.members.includes(id)) || (f.members.includes("none") && ids.length === 0);
    if (!hit) return false;
  }
  if (f.due.length) {
    const s = dueState(card.dueDate ?? null, !!card.isComplete, now);
    const hit = f.due.some((d) =>
      d === "none" ? !card.dueDate : d === "complete" ? s === "complete" : s === d);
    if (!hit) return false;
  }
  if (f.types.length && !f.types.includes(card.issueType ?? "task")) return false;
  if (f.priorities.length && !f.priorities.includes(card.priority ?? "medium")) return false;
  const tagged = (want: string[], have: { id: string }[] | undefined) =>
    have?.some((h) => want.includes(h.id)) || (want.includes("none") && !(have ?? []).length);
  if (f.versions.length && !tagged(f.versions, card.fixVersions)) return false;
  if (f.components.length && !tagged(f.components, card.components)) return false;
  if (f.blocked && !(card.badges?.blockedBy ?? 0)) return false;
  if (f.recent) {
    const t = card.updatedAt ? new Date(card.updatedAt).getTime() : 0;
    if (now - t > 7 * 86400000) return false;
  }
  return true;
}

// ---- URL round-trip, so a filtered board can be linked ----
const LIST_KEYS = ["labels", "members", "due", "types", "priorities", "versions", "components"] as const;

export function filterToParams(f: CardFilter, params = new URLSearchParams()): URLSearchParams {
  params.delete("q");
  if (f.q.trim()) params.set("q", f.q.trim());
  for (const flag of ["blocked", "recent"] as const) {
    params.delete(flag);
    if (f[flag]) params.set(flag, "1");
  }
  for (const k of LIST_KEYS) {
    params.delete(k);
    if (f[k].length) params.set(k, f[k].join(","));
  }
  return params;
}

export function filterFromParams(params: URLSearchParams): CardFilter {
  const list = (k: string) => (params.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    q: params.get("q") ?? "",
    labels: list("labels"),
    members: list("members"),
    due: list("due").filter((d): d is CardFilter["due"][number] => ["overdue", "soon", "none", "complete"].includes(d)),
    types: list("types"),
    priorities: list("priorities"),
    versions: list("versions"),
    components: list("components"),
    blocked: params.get("blocked") === "1",
    recent: params.get("recent") === "1",
  };
}
