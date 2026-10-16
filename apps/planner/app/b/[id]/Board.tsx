"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, closestCorners, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, horizontalListSortingStrategy, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { positionAt } from "@/lib/position";
import { CardModal } from "./CardModal";
import { CalendarView, TableView, TimelineView } from "./Views";
import { SharePanel } from "./SharePanel";
import { describeActivity, relativeTime, type ActivityRow } from "@/lib/describe-activity";
import { dueLabel, dueState, shortDate } from "@/lib/due";
import {
  EMPTY_FILTER, filterFromParams, filterToParams, isFiltering, matchesFilter, type CardFilter,
} from "@/lib/card-filter";
import { lanesFor, type GroupBy } from "@/lib/swimlanes";

type Lbl = { id: string; name: string | null; color: string };
type Badges = { checklistDone: number; checklistTotal: number; comments: number; attachments: number; hasDescription: boolean; blockedBy?: number };
type Card = {
  id: string; listId: string; title: string; position: number; origin: string; labels?: Lbl[];
  issueKey?: string | null; issueType?: string; priority?: string; points?: number | null;
  parentId?: string | null; description?: string | null;
  // Dates arrive as Date from the server component and as ISO strings from the JSON refetch.
  dueDate?: string | Date | null; startDate?: string | Date | null; isComplete?: boolean;
  cover?: string | null; coverUrl?: string | null; resolution?: string | null;
  members?: { id: string; name: string; isMind: boolean }[]; badges?: Badges;
  fixVersions?: { id: string; name: string }[]; components?: { id: string; name: string }[];
  assigneeId?: string | null; assignee?: { id: string; name: string; isMind: boolean } | null;
};
type Parent = { issueKey?: string | null; title: string };
type Category = "todo" | "in_progress" | "done";
type List = { id: string; title: string; position: number; wipLimit?: number | null; statusCategory?: Category };
const CATEGORY_LABEL: Record<Category, string> = { todo: "To Do", in_progress: "In Progress", done: "Done" };
type Col = List & { cards: Card[] };
type BoardInfo = {
  id: string; title: string; description?: string | null; background?: string | null;
  keyPrefix?: string; isClosed?: boolean;
};
type Person = { id: string; name: string; isMind: boolean; isMe?: boolean };
type View = "board" | "table" | "calendar" | "timeline";
const VIEWS: { value: View; label: string }[] = [
  { value: "board", label: "Board" },
  { value: "table", label: "Table" },
  { value: "calendar", label: "Calendar" },
  { value: "timeline", label: "Timeline" },
];
const GROUPS: { value: GroupBy; label: string }[] = [
  { value: "none", label: "No grouping" },
  { value: "epic", label: "Epic" },
  { value: "assignee", label: "Assignee" },
  { value: "priority", label: "Priority" },
  { value: "type", label: "Type" },
];

type Rule = { id: string; name: string; trigger: { on: string; toListId?: string }; action: { do: string; [k: string]: unknown }; isEnabled: boolean };
const TRIGGER_LABEL: Record<string, string> = {
  card_created: "a card is created", card_moved: "a card is moved", card_completed: "a card is completed",
};
const ACTION_LABEL: Record<string, string> = {
  complete: "mark it complete", archive: "archive it", move: "move it to", label: "add the label",
  comment: "comment", priority: "set priority to", due: "set the due date in (days)", assign: "assign it to",
};
// Which actions need a second value, and where that value comes from.
const ACTION_ARG: Record<string, "list" | "label" | "text" | "priority" | "days" | "person" | ""> = {
  complete: "", archive: "", move: "list", label: "label", comment: "text", priority: "priority", due: "days", assign: "person",
};

const TYPE_MARK: Record<string, string> = { epic: "E", story: "S", task: "T", bug: "B", subtask: "·" };
const PRIO_MARK: Record<string, string> = { highest: "⤒", high: "↑", medium: "=", low: "↓", lowest: "⤓" };
const BACKGROUNDS = ["#0b0f17", "#0f2a4a", "#12332a", "#3b1f47", "#4a2a12", "#3f1d1d", "#1f2937", "#134e4a"];
const json = (method: string, body?: unknown): RequestInit => ({
  method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const COL = "col:";

function SortableCard({ card, onOpen, parent }:
  { card: Card; onOpen: (id: string) => void; parent?: Parent | null }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, data: { type: "card" } });
  const down = useRef<{ x: number; y: number } | null>(null);
  const style = { transform: CSS.Translate.toString(transform), transition };
  // dnd-kit swallows the native click, so detect a click as pointer-up with < 5px of movement.
  const dndDown = (listeners as unknown as { onPointerDown?: (e: React.PointerEvent) => void })?.onPointerDown;
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      onPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY }; dndDown?.(e); }}
      onPointerUp={(e) => { const d = down.current; down.current = null; if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) onOpen(card.id); }}
      className={`card-item${card.origin === "mind" ? " mind" : ""}${isDragging ? " drag" : ""}`}>
      {card.cover?.startsWith("#") && <div className="facecover" style={{ background: card.cover }} />}
      {card.coverUrl && <div className="facecover img" style={{ backgroundImage: `url("${encodeURI(card.coverUrl)}")` }} />}
      {card.labels && card.labels.length > 0 && (
        <div className="facelabels">{card.labels.map((l) => <span key={l.id} style={{ background: l.color }} title={l.name ?? undefined} />)}</div>)}
      {card.origin === "mind" && <div className="badge">mind</div>}
      {parent && <div className="epicchip" title={parent.title}>{parent.issueKey || parent.title}</div>}
      {card.title}
      <div className="cardmeta">
        <span className={`itype ${card.issueType || "task"}`}>{TYPE_MARK[card.issueType || "task"]}</span>
        {card.issueKey && <span className="ikey">{card.issueKey}</span>}
        <span className={`prio ${card.priority || "medium"}`}>{PRIO_MARK[card.priority || "medium"]}</span>
        {card.points != null && <span className="pts">{card.points}</span>}
      </div>
      <FaceBadges card={card} />
    </div>
  );
}

/** The Trello card-face row: dates, description, comments, attachments, checklist, and who is on it. */
function FaceBadges({ card }: { card: Card }) {
  const b = card.badges;
  const due = dueState(card.dueDate ?? null, !!card.isComplete);
  // The assignee leads, ringed; members follow without repeating them.
  const members = [...(card.assignee ? [card.assignee] : []), ...(card.members ?? []).filter((m) => m.id !== card.assigneeId)];
  const any = (card.isComplete && card.resolution && card.resolution !== "done") || due || card.startDate || b?.hasDescription || b?.comments || b?.attachments || b?.checklistTotal || b?.blockedBy || members.length;
  if (!any) return null;
  return (
    <div className="facebadges">
      {card.isComplete && card.resolution && card.resolution !== "done" && (
        <span className="fb resolution" title="Resolution">{({ wont_do: "Won't do", duplicate: "Duplicate", cannot_reproduce: "Can't reproduce" } as Record<string, string>)[card.resolution]}</span>
      )}
      {!!b?.blockedBy && <span className="fb blocked" title={`Blocked by ${b.blockedBy} open issue(s)`}>⛔ Blocked</span>}
      {due && (
        <span className={`fb due ${due}`} title={`${dueLabel(due)}: ${shortDate(card.dueDate!)}`}>
          🕑 {card.startDate ? `${shortDate(card.startDate)} – ` : ""}{shortDate(card.dueDate!)}
        </span>
      )}
      {!due && card.startDate && <span className="fb" title="Start date">▶ {shortDate(card.startDate)}</span>}
      {b?.hasDescription && <span className="fb" title="This card has a description">≡</span>}
      {!!b?.comments && <span className="fb" title={`${b.comments} comment(s)`}>💬 {b.comments}</span>}
      {!!b?.attachments && <span className="fb" title={`${b.attachments} attachment(s)`}>📎 {b.attachments}</span>}
      {!!b?.checklistTotal && (
        <span className={`fb ${b.checklistDone === b.checklistTotal ? "allDone" : ""}`} title="Checklist items">
          ☑ {b.checklistDone}/{b.checklistTotal}
        </span>
      )}
      {members.length > 0 && (
        <span className="facemembers">
          {members.slice(0, 4).map((m) => (
            <span key={m.id} className={`fav${m.id === card.assigneeId ? " assignee" : ""}`} title={m.id === card.assigneeId ? `${m.name} (assignee)` : m.name}
              style={{ background: m.isMind ? "#5b8cff" : "#2a3346" }}>
              {m.isMind ? "🧠" : m.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
            </span>
          ))}
          {members.length > 4 && <span className="fav more">+{members.length - 4}</span>}
        </span>
      )}
    </div>
  );
}

function Column({ col, visible, filtering, onAddCard, onOpen, onRename, onArchive, onWip, onCategory, parents, canEdit }:
  { col: Col; visible: Card[]; filtering: boolean; onAddCard: (listId: string, title: string) => void; onOpen: (id: string) => void;
    onRename: (listId: string, title: string) => void; onArchive: (listId: string) => void; onWip: (list: Col) => void;
    onCategory: (listId: string, c: Category) => void;
    parents: Record<string, Parent>; canEdit: boolean }) {
  // The column is both sortable (drag the header to reorder lists) and the drop target for cards.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `${COL}${col.id}`, data: { type: "col" } });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(col.title);
  const [menu, setMenu] = useState(false);
  const submit = () => { if (title.trim()) { onAddCard(col.id, title.trim()); setTitle(""); } };
  const commitRename = () => {
    setRenaming(false);
    const next = draft.trim();
    if (next && next !== col.title) onRename(col.id, next);
    else setDraft(col.title);
  };
  const over = col.wipLimit != null && col.cards.length > col.wipLimit;
  return (
    <div ref={setNodeRef} className={`list${over ? " overwip" : ""}${isDragging ? " dragging" : ""}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}>
      <div className="list-h" {...(canEdit ? { ...attributes, ...listeners } : {})} style={{ cursor: canEdit ? "grab" : undefined }}>
        {renaming ? (
          <input autoFocus aria-label="List title" value={draft} className="renameinput"
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") { setDraft(col.title); setRenaming(false); }
            }} />
        ) : (
          <span className="ltitle" onDoubleClick={() => { if (canEdit) { setDraft(col.title); setRenaming(true); } }}
            title={canEdit ? "Double-click to rename, drag to reorder" : undefined}>
            {col.title}
          </span>
        )}
        {/* "3 / 5" reads as a WIP count; a filter says "1 of 3" so the two never look alike. */}
        {col.statusCategory && (
          <span className={`cat ${col.statusCategory}`} title={`Status category: ${CATEGORY_LABEL[col.statusCategory]}${col.statusCategory === "done" ? " — cards moved here are resolved" : ""}`}>
            {col.statusCategory === "done" ? "✓" : col.statusCategory === "in_progress" ? "◐" : "○"}
          </span>
        )}
        <span className={`n${over ? " over" : ""}`}
          title={col.wipLimit != null ? `${col.cards.length} cards, WIP limit ${col.wipLimit}` : `${col.cards.length} cards`}>
          {filtering && <span className="nfilter">{visible.length} of </span>}
          {col.cards.length}{col.wipLimit != null && ` / ${col.wipLimit}`}
        </span>
        {canEdit && (
          <span style={{ position: "relative" }} onPointerDown={(e) => e.stopPropagation()}>
            <button className="mini" aria-label={`List actions for ${col.title}`} onClick={() => setMenu((m) => !m)}>⋯</button>
            {menu && (
              <div className="lmenu" onMouseLeave={() => setMenu(false)}>
                <button onClick={() => { setMenu(false); setDraft(col.title); setRenaming(true); }}>Rename list</button>
                <button onClick={() => { setMenu(false); onWip(col); }}>{col.wipLimit != null ? "Change WIP limit" : "Set WIP limit"}</button>
                <div className="lmenulabel">Status category</div>
                {(["todo", "in_progress", "done"] as Category[]).map((c) => (
                  <button key={c} className={col.statusCategory === c ? "on" : ""} onClick={() => { setMenu(false); onCategory(col.id, c); }}>
                    {col.statusCategory === c ? "● " : "○ "}{CATEGORY_LABEL[c]}
                  </button>
                ))}
                <div className="lmenusep" />
                <button onClick={() => { setMenu(false); onArchive(col.id); }}>Archive list</button>
              </div>
            )}
          </span>
        )}
      </div>
      <SortableContext items={visible.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div className="cards">
          {visible.map((c) => (
            <SortableCard key={c.id} card={c} onOpen={onOpen} parent={c.parentId ? parents[c.parentId] : null} />
          ))}
        </div>
      </SortableContext>
      {adding ? (
        <div style={{ marginTop: 8 }}>
          <textarea autoFocus placeholder="Card title…" value={title} rows={2} style={{ width: "100%" }}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button className="btn" onClick={submit}>Add</button>
            <button className="mini" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : canEdit ? <div className="add" onClick={() => setAdding(true)}>+ Add a card</div> : null}
    </div>
  );
}

function FilterPanel({ filter, setFilter, labels, people, versions, components, onClose }:
  { filter: CardFilter; setFilter: (f: CardFilter) => void; labels: Lbl[]; people: Person[];
    versions: { id: string; name: string }[]; components: { id: string; name: string }[]; onClose: () => void }) {
  const toggle = <K extends "labels" | "members" | "due" | "types" | "priorities" | "versions" | "components">(key: K, v: CardFilter[K][number]) => {
    const cur = filter[key] as string[];
    setFilter({ ...filter, [key]: cur.includes(v as string) ? cur.filter((x) => x !== v) : [...cur, v] });
  };
  const chip = (on: boolean) => `fchip${on ? " on" : ""}`;
  return (
    <div className="searchresults filters">
      <div className="shead">
        <b>Filter cards</b>
        <span className="muted">choices within a group match any; groups combine</span>
        <div style={{ flex: 1 }} />
        {isFiltering(filter) && <button className="mini" onClick={() => setFilter(EMPTY_FILTER)}>Clear all</button>}
        <button className="mini" onClick={onClose}>close</button>
      </div>
      <div className="fgrid">
        <div className="fgroup">
          <div className="mlabel">Keyword</div>
          <input type="search" placeholder="Title, key or description…" value={filter.q} aria-label="Filter keyword"
            onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        </div>
        <div className="fgroup">
          <div className="mlabel">Members</div>
          <div className="mrow">
            <button className={chip(filter.members.includes("none"))} onClick={() => toggle("members", "none")}>No members</button>
            {people.map((p) => (
              <button key={p.id} className={chip(filter.members.includes(p.id))} onClick={() => toggle("members", p.id)}>{p.isMind ? "🧠 " : ""}{p.name}</button>
            ))}
          </div>
        </div>
        <div className="fgroup">
          <div className="mlabel">Due</div>
          <div className="mrow">
            {([["overdue", "Overdue"], ["soon", "Due soon"], ["complete", "Complete"], ["none", "No due date"]] as const).map(([v, t]) => (
              <button key={v} className={chip(filter.due.includes(v))} onClick={() => toggle("due", v)}>{t}</button>
            ))}
          </div>
        </div>
        <div className="fgroup">
          <div className="mlabel">Labels</div>
          <div className="mrow">
            {labels.map((l) => (
              <button key={l.id} className={chip(filter.labels.includes(l.id))} onClick={() => toggle("labels", l.id)}>
                <span className="fsw" style={{ background: l.color }} />{l.name || "(no name)"}
              </button>
            ))}
            {!labels.length && <span className="muted" style={{ fontSize: 12 }}>No labels on this board.</span>}
          </div>
        </div>
        <div className="fgroup">
          <div className="mlabel">Type</div>
          <div className="mrow">
            {["epic", "story", "task", "bug", "subtask"].map((t) => (
              <button key={t} className={chip(filter.types.includes(t))} onClick={() => toggle("types", t)}>{t}</button>
            ))}
          </div>
        </div>
        {versions.length > 0 && (
          <div className="fgroup">
            <div className="mlabel">Fix version</div>
            <div className="mrow">
              <button className={chip(filter.versions.includes("none"))} onClick={() => toggle("versions", "none")}>No version</button>
              {versions.map((v) => <button key={v.id} className={chip(filter.versions.includes(v.id))} onClick={() => toggle("versions", v.id)}>{v.name}</button>)}
            </div>
          </div>
        )}
        {components.length > 0 && (
          <div className="fgroup">
            <div className="mlabel">Component</div>
            <div className="mrow">
              <button className={chip(filter.components.includes("none"))} onClick={() => toggle("components", "none")}>No component</button>
              {components.map((c) => <button key={c.id} className={chip(filter.components.includes(c.id))} onClick={() => toggle("components", c.id)}>{c.name}</button>)}
            </div>
          </div>
        )}
        <div className="fgroup">
          <div className="mlabel">Priority</div>
          <div className="mrow">
            {["highest", "high", "medium", "low", "lowest"].map((p) => (
              <button key={p} className={chip(filter.priorities.includes(p))} onClick={() => toggle("priorities", p)}>{PRIO_MARK[p]} {p}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Board({ board, initialLists, initialCards, canEdit = true, canAdmin = false, initialStarred = false }:
  { board: BoardInfo; initialLists: List[]; initialCards: Card[]; canEdit?: boolean; canAdmin?: boolean; initialStarred?: boolean }) {
  const [cols, setCols] = useState<Col[]>(() =>
    initialLists.map((l) => ({ ...l, cards: initialCards.filter((c) => c.listId === l.id) })));
  const [info, setInfo] = useState<BoardInfo>(board);
  const [starred, setStarred] = useState(initialStarred);
  const [renamingBoard, setRenamingBoard] = useState(false);
  const [titleDraft, setTitleDraft] = useState(board.title);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openCardId, setOpenCardIdState] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | "filter" | "settings" | "share" | "activity" | "archived">(null);
  const [filter, setFilterState] = useState<CardFilter>(EMPTY_FILTER);
  const [groupBy, setGroupByState] = useState<GroupBy>("none");
  const [view, setViewState] = useState<View>("board");
  const [boardLabels, setBoardLabels] = useState<Lbl[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [boardVersions, setBoardVersions] = useState<{ id: string; name: string }[]>([]);
  const [boardComponents, setBoardComponents] = useState<{ id: string; name: string }[]>([]);
  const [customFields, setCustomFields] = useState<{ id: string; name: string; type: string; options: string[] | null }[]>([]);
  const [fieldDraft, setFieldDraft] = useState({ name: "", type: "text", options: "" });
  const [rules, setRules] = useState<Rule[]>([]);
  const [ruleDraft, setRuleDraft] = useState({ name: "", on: "card_moved", toListId: "", do: "complete", arg: "" });
  const [archived, setArchived] = useState<{ cards: Card[]; lists: List[] } | null>(null);
  const [feed, setFeed] = useState<{ rows: ActivityRow[]; more: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The open card and the active filter live in the URL, so a card or a filtered view can be linked,
  // bookmarked and reloaded. replaceState, not pushState: neither should fill the back button.
  const syncUrl = (card: string | null, f: CardFilter, group: GroupBy = groupBy, v: View = view) => {
    const url = new URL(window.location.href);
    if (v !== "board") url.searchParams.set("view", v); else url.searchParams.delete("view");
    if (card) url.searchParams.set("card", card); else url.searchParams.delete("card");
    filterToParams(f, url.searchParams);
    if (group !== "none") url.searchParams.set("group", group); else url.searchParams.delete("group");
    window.history.replaceState(null, "", url);
  };
  const setGroupBy = (g: GroupBy) => { setGroupByState(g); syncUrl(openCardId, filter, g); };
  const setView = (v: View) => { setViewState(v); syncUrl(openCardId, filter, groupBy, v); };
  const setOpenCardId = (id: string | null) => { setOpenCardIdState(id); syncUrl(id, filter); };
  const setFilter = (f: CardFilter) => { setFilterState(f); syncUrl(openCardId, f); };
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const card = params.get("card");
    if (card) setOpenCardIdState(card);
    const f = filterFromParams(params);
    if (isFiltering(f)) { setFilterState(f); setPanel("filter"); }
    const g = params.get("group");
    if (g && GROUPS.some((x) => x.value === g)) setGroupByState(g as GroupBy);
    const v = params.get("view");
    if (v && VIEWS.some((x) => x.value === v)) setViewState(v as View);
    if (params.get("settings")) setPanel("settings");
  }, []);

  // Observers get no drag sensor at all: the server would refuse the move, and a card that snaps
  // back after a drop is worse than one that never lifts.
  const pointer = useSensor(PointerSensor, { activationConstraint: { distance: 5 } });
  // Swimlanes change what a drop means (it would have to rewrite the grouped field as well as the
  // column), so dragging is off while they are on rather than silently doing the wrong thing.
  const dragEnabled = canEdit && groupBy === "none";
  const sensors = useSensors(...(dragEnabled ? [pointer] : []));

  const parents: Record<string, Parent> = {};
  for (const col of cols) for (const c of col.cards) parents[c.id] = { issueKey: c.issueKey, title: c.title };
  const dragging = useRef(false);

  // live sync: refetch the board when anything changes (human OR mind), unless mid-drag
  async function refetch() {
    if (dragging.current) return;
    const r = await fetch(`/api/boards/${board.id}`);
    if (!r.ok) return;
    const d: { board: BoardInfo; lists: List[]; cards: Card[] } = await r.json();
    setCols(d.lists.map((l) => ({ ...l, cards: d.cards.filter((c) => c.listId === l.id) })));
    if (d.board) setInfo(d.board);
  }
  useEffect(() => {
    const es = new EventSource(`/api/stream/${board.id}`);
    es.onmessage = (ev) => { try { if (JSON.parse(ev.data).type === "changed") refetch(); } catch { /* ignore */ } };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.id]);

  const loadRules = useCallback(async () => {
    const r = await fetch(`/api/boards/${board.id}/automations`);
    if (r.ok) setRules(await r.json());
  }, [board.id]);

  async function saveRule() {
    const arg = ruleDraft.arg.trim();
    const need = ACTION_ARG[ruleDraft.do];
    if (!ruleDraft.name.trim()) { setError("Give the rule a name, so the history says what ran."); return; }
    if (need && !arg) { setError("That action needs a value."); return; }
    const action: Record<string, unknown> = { do: ruleDraft.do };
    if (need === "list") action.toListId = arg;
    if (need === "label") action.labelId = arg;
    if (need === "text") action.text = arg;
    if (need === "priority") action.value = arg;
    if (need === "days") action.plusDays = Number(arg);
    if (need === "person") action.userId = arg === "none" ? null : arg;
    const trigger: Record<string, unknown> = { on: ruleDraft.on };
    if (ruleDraft.on === "card_moved" && ruleDraft.toListId) trigger.toListId = ruleDraft.toListId;
    const r = await fetch(`/api/boards/${board.id}/automations`, json("POST", { name: ruleDraft.name, trigger, action }));
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error || "Could not save that rule."); return; }
    setRuleDraft({ name: "", on: "card_moved", toListId: "", do: "complete", arg: "" });
    loadRules();
  }

  const loadFilterOptions = useCallback(async () => {
    const [l, u, s] = await Promise.all([fetch(`/api/labels?boardId=${board.id}`), fetch("/api/users"), fetch(`/api/boards/${board.id}`)]);
    if (l.ok) setBoardLabels(await l.json());
    if (u.ok) setPeople(await u.json());
    if (s.ok) { const d = await s.json(); setBoardVersions(d.versions ?? []); setBoardComponents(d.components ?? []); setCustomFields(d.customFields ?? []); }
  }, [board.id]);
  useEffect(() => { loadFilterOptions(); loadRules(); }, [loadFilterOptions, loadRules]);

  const closeCard = useCallback(() => setOpenCardId(null), [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Copying lands the new board in the caller's own workspace, so go straight to it.
  async function copyBoard(withCards: boolean) {
    const r = await fetch(`/api/boards/${board.id}/copy`, json("POST", { withCards }));
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error || "Could not copy the board."); return; }
    const { boardId } = await r.json();
    window.location.href = `/b/${boardId}`;
  }

  // The calendar drops a card on a day: write the due date through, then let the stream refetch.
  async function setDue(cardId: string, day: string | null) {
    setCols((cs) => cs.map((c) => ({ ...c, cards: c.cards.map((x) => (x.id === cardId ? { ...x, dueDate: day } : x)) })));
    const r = await fetch(`/api/cards/${cardId}`, json("PATCH", { dueDate: day }));
    if (!r.ok) { setError("Could not move that card's due date."); refetch(); }
  }

  function onCardChange(id: string, patch: { title?: string; labels?: Lbl[] }) {
    setCols((prev) => prev.map((c) => ({
      ...c, cards: c.cards.map((k) => k.id === id
        ? { ...k, ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.labels ? { labels: patch.labels } : {}) }
        : k),
    })));
  }

  const me = people.find((p) => p.isMe) ?? null;
  const toggleMember = (id: string) =>
    setFilter({ ...filter, members: filter.members.includes(id) ? filter.members.filter((m) => m !== id) : [...filter.members, id] });

  const filtering = isFiltering(filter);
  const visibleOf = (col: Col) => (filtering ? col.cards.filter((c) => matchesFilter(c, filter)) : col.cards);
  // Table, calendar and timeline all read the same filtered set, in board order.
  const shown = cols.flatMap(visibleOf);
  const totalCards = cols.reduce((n, c) => n + c.cards.length, 0);
  const matching = filtering ? cols.reduce((n, c) => n + visibleOf(c).length, 0) : totalCards;

  const activeCard = useMemo(
    () => cols.flatMap((c) => c.cards).find((c) => c.id === activeId) ?? null, [cols, activeId]);
  const activeCol = activeId?.startsWith(COL) ? cols.find((c) => `${COL}${c.id}` === activeId) ?? null : null;

  const colOfCard = (list: Col[], cardId: string) => list.find((c) => c.cards.some((k) => k.id === cardId));
  const targetCol = (list: Col[], overId: string) =>
    overId.startsWith(COL) ? list.find((c) => c.id === overId.slice(COL.length)) : colOfCard(list, overId);

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over || String(active.id).startsWith(COL)) return;   // list drags are resolved on drop
    setCols((prev) => {
      const from = colOfCard(prev, String(active.id));
      const to = targetCol(prev, String(over.id));
      if (!from || !to || from.id === to.id) return prev;
      const card = from.cards.find((c) => c.id === active.id)!;
      const overIdx = to.cards.findIndex((c) => c.id === over.id);
      return prev.map((c) => {
        if (c.id === from.id) return { ...c, cards: c.cards.filter((k) => k.id !== active.id) };
        if (c.id === to.id) {
          const next = [...c.cards];
          next.splice(overIdx >= 0 ? overIdx : next.length, 0, { ...card, listId: to.id });
          return { ...c, cards: next };
        }
        return c;
      });
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveId(null);
    dragging.current = false;
    if (!over) return;
    const activeKey = String(active.id);

    // Reordering lists.
    if (activeKey.startsWith(COL)) {
      const overKey = String(over.id);
      const overColId = overKey.startsWith(COL) ? overKey.slice(COL.length) : colOfCard(cols, overKey)?.id;
      const from = cols.findIndex((c) => `${COL}${c.id}` === activeKey);
      const to = cols.findIndex((c) => c.id === overColId);
      if (from < 0 || to < 0 || from === to) return;
      const reordered = arrayMove(cols, from, to);
      const position = positionAt(reordered, to);
      const moved = { ...reordered[to], position };
      reordered[to] = moved;
      setCols(reordered);
      fetch(`/api/lists/${moved.id}`, json("PATCH", { position })).then((r) => { if (!r.ok) refetch(); });
      return;
    }

    // Moving a card. `cols` is the latest render (dnd-kit calls the current handler), which already
    // includes any cross-list move made in onDragOver. Compute the final order and the position from
    // that one array, synchronously, then set state and persist the same values. The old version read
    // neighbours in a setTimeout from state captured before the reorder, so a within-list move saved
    // the card's old position and snapped back on the next refetch.
    const to = targetCol(cols, String(over.id));
    if (!to) return;
    const fromIdx = to.cards.findIndex((k) => k.id === activeKey);
    if (fromIdx < 0) return;
    let destIdx = to.cards.findIndex((k) => k.id === over.id);
    if (destIdx < 0) destIdx = to.cards.length - 1;
    const ordered = arrayMove(to.cards, fromIdx, destIdx);
    const position = positionAt(ordered, destIdx);
    ordered[destIdx] = { ...ordered[destIdx], position, listId: to.id };
    setCols(cols.map((c) => (c.id === to.id ? { ...c, cards: ordered } : c)));
    fetch(`/api/cards/${activeKey}`, json("PATCH", { listId: to.id, position })).then((r) => { if (!r.ok) refetch(); });
  }

  async function addCard(listId: string, title: string) {
    const r = await fetch("/api/cards", json("POST", { listId, title }));
    if (r.ok) {
      const card: Card = await r.json();
      setCols((prev) => prev.map((c) => (c.id === listId ? { ...c, cards: [...c.cards, card] } : c)));
    }
  }

  async function addList() {
    const title = prompt("List title");
    if (!title?.trim()) return;
    const r = await fetch("/api/lists", json("POST", { boardId: board.id, title }));
    if (r.ok) { const l: List = await r.json(); setCols((prev) => [...prev, { ...l, cards: [] }]); }
  }

  async function renameList(listId: string, title: string) {
    setCols((prev) => prev.map((c) => (c.id === listId ? { ...c, title } : c)));   // optimistic
    const r = await fetch(`/api/lists/${listId}`, json("PATCH", { title }));
    if (!r.ok) refetch();   // put the real title back if the server refused
  }

  async function setCategory(listId: string, statusCategory: Category) {
    setCols((prev) => prev.map((c) => (c.id === listId ? { ...c, statusCategory } : c)));   // optimistic
    const r = await fetch(`/api/lists/${listId}`, json("PATCH", { statusCategory }));
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error || "Could not change the category."); refetch(); }
  }

  async function setWip(col: Col) {
    const raw = prompt(`WIP limit for "${col.title}" (blank or 0 for none)`, col.wipLimit != null ? String(col.wipLimit) : "");
    if (raw === null) return;
    const n = raw.trim() === "" ? null : Number(raw);
    if (n !== null && !(Number.isInteger(n) && n >= 0)) { setError("A WIP limit is a whole number."); return; }
    const r = await fetch(`/api/lists/${col.id}`, json("PATCH", { wipLimit: n }));
    if (!r.ok) setError((await r.json().catch(() => ({}))).error || "Could not set the WIP limit.");
    refetch();
  }

  // Archive, never delete, from the board face: the cards stay and the list can be restored from
  // the archived view. Deletion of a list (and its cards) stays out of a one-click path.
  async function archiveList(listId: string) {
    const col = cols.find((c) => c.id === listId);
    if (col && col.cards.length && !confirm(`Archive "${col.title}"? Its ${col.cards.length} card(s) are kept and can be restored.`)) return;
    setCols((prev) => prev.filter((c) => c.id !== listId));   // optimistic
    const r = await fetch(`/api/lists/${listId}`, json("PATCH", { isArchived: true }));
    if (!r.ok) refetch();
  }

  async function saveBoard(change: Partial<BoardInfo>) {
    setError(null);
    const r = await fetch(`/api/boards/${board.id}`, json("PATCH", change));
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error || `That change was refused (${r.status}).`); return false; }
    setInfo(await r.json());
    return true;
  }

  async function renameBoard() {
    const next = titleDraft.trim();
    setRenamingBoard(false);
    if (!next || next === info.title) { setTitleDraft(info.title); return; }
    if (!(await saveBoard({ title: next }))) setTitleDraft(info.title);
  }

  async function toggleStar() {
    const next = !starred;
    setStarred(next);   // optimistic
    const r = await fetch(`/api/boards/${board.id}/star`, json(next ? "POST" : "DELETE"));
    if (!r.ok) setStarred(!next);
  }

  async function closeBoard() {
    if (!confirm(`Close "${info.title}"? It disappears from everyone's board list until an admin reopens it.`)) return;
    if (await saveBoard({ isClosed: true })) window.location.href = "/";
  }

  const FEED_PAGE = 50;
  async function openActivity(older = false) {
    setPanel("activity");
    const last = older && feed?.rows.length ? feed.rows[feed.rows.length - 1].createdAt : null;
    const qs = new URLSearchParams({ limit: String(FEED_PAGE) });
    if (last) qs.set("before", new Date(last).toISOString());
    const r = await fetch(`/api/boards/${board.id}/activity?${qs}`);
    if (!r.ok) return;
    const rows: ActivityRow[] = await r.json();
    setFeed({ rows: older && feed ? [...feed.rows, ...rows] : rows, more: rows.length === FEED_PAGE });
  }

  async function openArchived() {
    setPanel("archived");
    const r = await fetch(`/api/boards/${board.id}/archived`);
    if (r.ok) setArchived(await r.json());
  }
  async function restoreCard(cardId: string) {
    await fetch(`/api/cards/${cardId}`, json("PATCH", { isArchived: false }));
    await openArchived();
    refetch();
  }
  async function restoreList(listId: string) {
    await fetch(`/api/lists/${listId}`, json("PATCH", { isArchived: false }));
    await openArchived();
    refetch();
  }

  const togglePanel = (p: typeof panel) => setPanel((cur) => (cur === p ? null : p));

  return (
    <div className="boardpage" style={info.background ? { background: info.background } : undefined}>
      <div className="boardhead">
        <a href="/" className="back">← Boards</a>
        {renamingBoard ? (
          <input autoFocus aria-label="Board title" value={titleDraft} className="renameinput"
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={renameBoard}
            onKeyDown={(e) => {
              if (e.key === "Enter") renameBoard();
              if (e.key === "Escape") { setTitleDraft(info.title); setRenamingBoard(false); }
            }} />
        ) : (
          <h1 onDoubleClick={() => { if (canEdit) { setTitleDraft(info.title); setRenamingBoard(true); } }}
            title={canEdit ? "Double-click to rename" : undefined}>{info.title}</h1>
        )}
        <button className={`star${starred ? " on" : ""}`} onClick={toggleStar} aria-pressed={starred}
          aria-label={starred ? "Unstar board" : "Star board"} title={starred ? "Unstar" : "Star"}>{starred ? "★" : "☆"}</button>
        {info.keyPrefix && <span className="spill" title="Issue key prefix">{info.keyPrefix}</span>}
        {!canEdit && <span className="spill" title="You can view this board but not change it">read-only</span>}
        <div style={{ flex: 1 }} />
        <span className="quickfilters">
          {me && (
            <button className={`fchip${filter.members.includes(me.id) ? " on" : ""}`} onClick={() => toggleMember(me.id)}>My issues</button>
          )}
          <button className={`fchip${filter.members.includes("none") ? " on" : ""}`} onClick={() => toggleMember("none")}>Unassigned</button>
          <button className={`fchip${filter.due.includes("overdue") ? " on" : ""}`}
            onClick={() => setFilter({ ...filter, due: filter.due.includes("overdue") ? filter.due.filter((d) => d !== "overdue") : [...filter.due, "overdue"] })}>Overdue</button>
          <button className={`fchip${filter.blocked ? " on" : ""}`} onClick={() => setFilter({ ...filter, blocked: !filter.blocked })}>Blocked</button>
          <button className={`fchip${filter.recent ? " on" : ""}`} onClick={() => setFilter({ ...filter, recent: !filter.recent })}>Updated 7d</button>
        </span>
        <span className="viewtabs" role="tablist" aria-label="Board view">
          {VIEWS.map((v) => (
            <button key={v.value} role="tab" aria-selected={view === v.value}
              className={`vtab${view === v.value ? " on" : ""}`} onClick={() => setView(v.value)}>{v.label}</button>
          ))}
        </span>
        {view === "board" && (
          <select className="plainsel" value={groupBy} aria-label="Group cards into swimlanes" onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
            {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.value === "none" ? "No swimlanes" : `Lanes: ${g.label}`}</option>)}
          </select>
        )}
        <button className={`mini${filtering ? " active" : ""}`} onClick={() => togglePanel("filter")} aria-pressed={panel === "filter"}>
          ⏷ Filter{filtering ? ` · ${matching}/${totalCards}` : ""}
        </button>
        <button className="mini" onClick={() => (panel === "activity" ? setPanel(null) : openActivity())}>Activity</button>
        <button className="mini" onClick={() => (panel === "archived" ? setPanel(null) : openArchived())}>Archived</button>
        <button className="mini" onClick={() => togglePanel("share")}>Share</button>
        <button className="mini" onClick={() => togglePanel("settings")} aria-label="Board settings">⚙</button>
        <a href={`/b/${board.id}/releases`} className="mini">Releases</a>
        <a href={`/b/${board.id}/reports`} className="mini">Reports</a>
        <a href={`/b/${board.id}/backlog`} className="btn">Backlog & Sprints</a>
      </div>
      {error && <div className="bnote warn" onClick={() => setError(null)}>{error} <span className="mini">dismiss</span></div>}

      {panel === "filter" && (
        <FilterPanel filter={filter} setFilter={setFilter} labels={boardLabels} people={people}
          versions={boardVersions} components={boardComponents} onClose={() => setPanel(null)} />
      )}
      {filtering && panel !== "filter" && (
        <div className="bnote" onClick={() => setPanel("filter")}>
          Showing {matching} of {totalCards} cards. <button className="linkbtn" onClick={(e) => { e.stopPropagation(); setFilter(EMPTY_FILTER); }}>Clear filter</button>
        </div>
      )}

      {panel === "share" && <SharePanel boardId={board.id} onClose={() => setPanel(null)} />}

      {panel === "settings" && (
        <div className="searchresults settings">
          <div className="shead"><b>Board settings</b><div style={{ flex: 1 }} /><button className="mini" onClick={() => setPanel(null)}>close</button></div>
          <fieldset className="mfield" disabled={!canEdit}>
            <div className="fgroup">
              <div className="mlabel">Description</div>
              <textarea rows={3} defaultValue={info.description ?? ""} placeholder="What is this board for?" style={{ width: "100%" }}
                aria-label="Board description"
                onBlur={(e) => { if (e.target.value !== (info.description ?? "")) saveBoard({ description: e.target.value }); }} />
            </div>
            <div className="fgroup">
              <div className="mlabel">Background</div>
              <div className="swatches">
                {BACKGROUNDS.map((b) => (
                  <button key={b} className={`sw big${info.background === b ? " on" : ""}`} style={{ background: b, border: "1px solid #334" }}
                    aria-label={`Background ${b}`} onClick={() => saveBoard({ background: b })} />
                ))}
                {info.background && <button className="mini" onClick={() => saveBoard({ background: null })}>Default</button>}
              </div>
            </div>
          </fieldset>
          <fieldset className="mfield" disabled={!canAdmin}>
            <div className="fgroup">
              <div className="mlabel">Issue key prefix {!canAdmin && <span className="muted">(admins only)</span>}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input defaultValue={info.keyPrefix} aria-label="Issue key prefix" style={{ width: 110, textTransform: "uppercase" }}
                  onBlur={(e) => { const v = e.target.value.trim().toUpperCase(); if (v && v !== info.keyPrefix) saveBoard({ keyPrefix: v }); }} />
                <span className="muted" style={{ fontSize: 12 }}>New cards only; existing keys never change.</span>
              </div>
            </div>
            <div className="fgroup">
              <div className="mlabel">Custom fields {!canAdmin && <span className="muted">(admins only)</span>}</div>
              {customFields.map((f) => (
                <div key={f.id} className="savedrow">
                  <span className="btitle">{f.name} <span className="muted">· {f.type}{f.options ? ` (${f.options.join(", ")})` : ""}</span></span>
                  <button className="mini" aria-label={`Delete field ${f.name}`}
                    onClick={async () => {
                      if (!confirm(`Delete the field "${f.name}" and its values on every card?`)) return;
                      const r = await fetch(`/api/fields/${f.id}`, json("DELETE"));
                      if (!r.ok) setError((await r.json().catch(() => ({}))).error || "Could not delete the field.");
                      loadFilterOptions();
                    }}>✕</button>
                </div>
              ))}
              <div className="relform" style={{ padding: "8px 0 0", borderBottom: 0 }}>
                <input placeholder="Field name" value={fieldDraft.name} aria-label="New field name"
                  onChange={(e) => setFieldDraft({ ...fieldDraft, name: e.target.value })} />
                <select className="plainsel" value={fieldDraft.type} aria-label="New field type"
                  onChange={(e) => setFieldDraft({ ...fieldDraft, type: e.target.value })}>
                  {["text", "number", "select", "date", "user", "checkbox"].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {fieldDraft.type === "select" && (
                  <input placeholder="Options, comma separated" value={fieldDraft.options} aria-label="Field options"
                    onChange={(e) => setFieldDraft({ ...fieldDraft, options: e.target.value })} />
                )}
                <button className="btn" onClick={async () => {
                  if (!fieldDraft.name.trim()) return;
                  const r = await fetch(`/api/boards/${board.id}/fields`, json("POST", {
                    name: fieldDraft.name, type: fieldDraft.type,
                    options: fieldDraft.type === "select" ? fieldDraft.options.split(",").map((o) => o.trim()).filter(Boolean) : undefined,
                  }));
                  if (!r.ok) { setError((await r.json().catch(() => ({}))).error || "Could not add the field."); return; }
                  setFieldDraft({ name: "", type: "text", options: "" });
                  loadFilterOptions();
                }}>Add field</button>
              </div>
            </div>

            <div className="fgroup">
              <div className="mlabel">Automation rules {!canAdmin && <span className="muted">(admins only)</span>}</div>
              {rules.map((r) => (
                <div key={r.id} className="savedrow">
                  <span className="btitle">
                    {r.name} <span className="muted">
                      · when {TRIGGER_LABEL[r.trigger.on] ?? r.trigger.on}
                      {r.trigger.toListId ? ` into ${cols.find((c) => c.id === r.trigger.toListId)?.title ?? "a list"}` : ""}
                      , {ACTION_LABEL[r.action.do] ?? r.action.do}
                    </span>
                  </span>
                  <button className="mini" aria-label={r.isEnabled ? `Disable ${r.name}` : `Enable ${r.name}`}
                    onClick={async () => {
                      await fetch(`/api/automations/${r.id}`, json("PATCH", { isEnabled: !r.isEnabled }));
                      loadRules();
                    }}>{r.isEnabled ? "on" : "off"}</button>
                  <button className="mini" aria-label={`Delete ${r.name}`}
                    onClick={async () => {
                      if (!confirm(`Delete the rule "${r.name}"?`)) return;
                      await fetch(`/api/automations/${r.id}`, json("DELETE"));
                      loadRules();
                    }}>✕</button>
                </div>
              ))}
              {!rules.length && <div className="muted" style={{ fontSize: 12, padding: "4px 0" }}>
                No rules yet. A rule runs once per event and never triggers another rule.
              </div>}
              <div className="relform" style={{ padding: "8px 0 0", borderBottom: 0 }}>
                <input placeholder="Rule name" value={ruleDraft.name} aria-label="Rule name"
                  onChange={(e) => setRuleDraft({ ...ruleDraft, name: e.target.value })} />
                <span className="muted">When</span>
                <select className="plainsel" value={ruleDraft.on} aria-label="Trigger"
                  onChange={(e) => setRuleDraft({ ...ruleDraft, on: e.target.value })}>
                  {Object.entries(TRIGGER_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {ruleDraft.on === "card_moved" && (
                  <select className="plainsel" value={ruleDraft.toListId} aria-label="Into list"
                    onChange={(e) => setRuleDraft({ ...ruleDraft, toListId: e.target.value })}>
                    <option value="">into any list</option>
                    {cols.map((c) => <option key={c.id} value={c.id}>into {c.title}</option>)}
                  </select>
                )}
                <span className="muted">then</span>
                <select className="plainsel" value={ruleDraft.do} aria-label="Action"
                  onChange={(e) => setRuleDraft({ ...ruleDraft, do: e.target.value, arg: "" })}>
                  {Object.entries(ACTION_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {ACTION_ARG[ruleDraft.do] === "list" && (
                  <select className="plainsel" value={ruleDraft.arg} aria-label="Destination list"
                    onChange={(e) => setRuleDraft({ ...ruleDraft, arg: e.target.value })}>
                    <option value="">choose a list</option>
                    {cols.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                )}
                {ACTION_ARG[ruleDraft.do] === "label" && (
                  <select className="plainsel" value={ruleDraft.arg} aria-label="Label"
                    onChange={(e) => setRuleDraft({ ...ruleDraft, arg: e.target.value })}>
                    <option value="">choose a label</option>
                    {boardLabels.map((l) => <option key={l.id} value={l.id}>{l.name || l.color}</option>)}
                  </select>
                )}
                {ACTION_ARG[ruleDraft.do] === "person" && (
                  <select className="plainsel" value={ruleDraft.arg} aria-label="Assignee"
                    onChange={(e) => setRuleDraft({ ...ruleDraft, arg: e.target.value })}>
                    <option value="">choose a person</option>
                    <option value="none">nobody</option>
                    {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                )}
                {ACTION_ARG[ruleDraft.do] === "priority" && (
                  <select className="plainsel" value={ruleDraft.arg} aria-label="Priority"
                    onChange={(e) => setRuleDraft({ ...ruleDraft, arg: e.target.value })}>
                    <option value="">choose a priority</option>
                    {["highest", "high", "medium", "low", "lowest"].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                )}
                {(ACTION_ARG[ruleDraft.do] === "text" || ACTION_ARG[ruleDraft.do] === "days") && (
                  <input aria-label="Action value" value={ruleDraft.arg}
                    type={ACTION_ARG[ruleDraft.do] === "days" ? "number" : "text"}
                    placeholder={ACTION_ARG[ruleDraft.do] === "days" ? "days" : "what to say"}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, arg: e.target.value })} />
                )}
                <button className="btn" onClick={saveRule}>Add rule</button>
              </div>
            </div>

            <div className="fgroup">
              <div className="mlabel">Danger zone {!canAdmin && <span className="muted">(admins only)</span>}</div>
              <button className="sidebtn danger" onClick={closeBoard}>Close board</button>
            </div>
          </fieldset>

          {/* Export needs only visibility, so it sits outside the admin fieldset; copying creates a
              board in the caller's own workspace, which anyone who can see this one may do. */}
          <div className="mfield">
            <div className="fgroup">
              <div className="mlabel">Export and copy</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <a className="sidebtn" href={`/api/boards/${board.id}/export`} download>Export as CSV</a>
                <button className="sidebtn" onClick={() => copyBoard(true)}>Copy board</button>
                <button className="sidebtn" onClick={() => copyBoard(false)}>Copy as template</button>
                <span className="muted" style={{ fontSize: 12 }}>A template copies the lists and labels, not the cards.</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {panel === "activity" && feed && (
        <div className="searchresults">
          <div className="shead">
            <b>Activity</b>
            <div style={{ flex: 1 }} />
            <button className="mini" onClick={() => setPanel(null)}>close</button>
          </div>
          {feed.rows.map((a) => (
            <div key={a.id} className="brow hist" style={{ cursor: a.cardId ? "pointer" : "default" }}
              onClick={() => a.cardId && setOpenCardId(a.cardId)}>
              <span className="btitle"><b>{a.actorIsMind ? "🧠 Mind" : (a.actor || "Someone")}</b> {describeActivity(a, "board")}</span>
              <span className="when">{relativeTime(a.createdAt)}</span>
            </div>
          ))}
          {!feed.rows.length && <div className="bempty">No activity yet.</div>}
          {feed.more && <button className="mini" style={{ padding: 10 }} onClick={() => openActivity(true)}>Load older</button>}
        </div>
      )}

      {panel === "archived" && archived && (
        <div className="searchresults">
          <div className="shead">
            <b>Archived</b>
            <span className="muted">{archived.cards.length} card(s), {archived.lists.length} list(s)</span>
            <div style={{ flex: 1 }} />
            <button className="mini" onClick={() => setPanel(null)}>close</button>
          </div>
          {archived.lists.map((l) => (
            <div key={l.id} className="brow">
              <span className="muted">list</span> {l.title}
              <div style={{ flex: 1 }} />
              {canEdit && <button className="mini" onClick={() => restoreList(l.id)}>Restore</button>}
            </div>
          ))}
          {archived.cards.map((c) => (
            <div key={c.id} className="brow">
              {c.issueKey && <span className="ikey">{c.issueKey}</span>} {c.title}
              <div style={{ flex: 1 }} />
              {canEdit && <button className="mini" onClick={() => restoreCard(c.id)}>Restore</button>}
            </div>
          ))}
          {!archived.cards.length && !archived.lists.length && <div className="bempty">Nothing archived.</div>}
        </div>
      )}

      {view !== "board" && (
        <div className="altview">
          {view === "table" && <TableView cards={shown} lists={cols} onOpen={setOpenCardId} />}
          {view === "calendar" && (
            <CalendarView cards={shown} lists={cols} onOpen={setOpenCardId} canEdit={canEdit} onSetDue={setDue} />
          )}
          {view === "timeline" && <TimelineView cards={shown} lists={cols} onOpen={setOpenCardId} />}
        </div>
      )}

      {view === "board" && (
            <DndContext id="board-dnd" sensors={sensors} collisionDetection={closestCorners}
        onDragStart={(e: DragStartEvent) => { dragging.current = true; setActiveId(String(e.active.id)); }}
        onDragOver={onDragOver} onDragEnd={onDragEnd}
        onDragCancel={() => { dragging.current = false; setActiveId(null); refetch(); }}>
        {groupBy === "none" ? (
          <div className="board">
            <SortableContext items={cols.map((c) => `${COL}${c.id}`)} strategy={horizontalListSortingStrategy}>
              {cols.map((col) => (
                <Column key={col.id} col={col} visible={visibleOf(col)} filtering={filtering}
                  onAddCard={addCard} onOpen={setOpenCardId} onRename={renameList} onArchive={archiveList} onWip={setWip} onCategory={setCategory}
                  parents={parents} canEdit={canEdit} />
              ))}
            </SortableContext>
            {canEdit && (
              <div className="list" style={{ background: "transparent", border: "1px dashed var(--line)" }}>
                <div className="add" onClick={addList}>+ Add a list</div>
              </div>
            )}
          </div>
        ) : (
          <div className="lanes">
            <div className="bnote" style={{ cursor: "default", margin: "8px 20px 0" }}>
              Swimlanes by {GROUPS.find((g) => g.value === groupBy)?.label.toLowerCase()} — dragging is off while lanes are on.
            </div>
            {lanesFor(
              cols.flatMap((c) => visibleOf(c)),
              groupBy,
              {
                parents: Object.fromEntries(cols.flatMap((c) => c.cards).map((c) => [c.id, c.issueKey ? `${c.issueKey} ${c.title}` : c.title])),
                people: Object.fromEntries(people.map((p) => [p.id, p.name])),
              },
            ).map((lane) => (
              <div key={lane.key} className="lane">
                <div className="lanehead"><b>{lane.label}</b><span className="muted">{lane.cards.length}</span></div>
                <div className="board lanebody">
                  {cols.map((col) => {
                    const mine = lane.cards.filter((c) => c.listId === col.id);
                    return (
                      <div key={col.id} className="list lanecol">
                        <div className="list-h"><span className="ltitle">{col.title}</span><span className="n">{mine.length}</span></div>
                        <div className="cards">
                          {mine.map((c) => (
                            <div key={c.id} className={`card-item${c.origin === "mind" ? " mind" : ""}`} onClick={() => setOpenCardId(c.id)}>
                              {c.title}
                              <div className="cardmeta">
                                <span className={`itype ${c.issueType || "task"}`}>{TYPE_MARK[c.issueType || "task"]}</span>
                                {c.issueKey && <span className="ikey">{c.issueKey}</span>}
                                <span className={`prio ${c.priority || "medium"}`}>{PRIO_MARK[c.priority || "medium"]}</span>
                              </div>
                              <FaceBadges card={c} />
                            </div>
                          ))}
                          {!mine.length && <div className="laneempty">—</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        <DragOverlay>
          {activeCard ? <div className="card-item">{activeCard.title}</div> : null}
          {activeCol ? <div className="list dragoverlay"><div className="list-h">{activeCol.title}</div></div> : null}
        </DragOverlay>
      </DndContext>
      )}

      {openCardId && (
        <CardModal cardId={openCardId} boardId={board.id} canEdit={canEdit}
          onClose={closeCard} onChange={onCardChange} />)}
    </div>
  );
}
