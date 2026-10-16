"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describeActivity, relativeTime, type ActivityRow } from "@/lib/describe-activity";
import { dueState, dueLabel } from "@/lib/due";
import { activeMentionQuery, mentionToken, mentionsToMarkdown, splitMentions } from "@/lib/mentions";
import { formatDuration } from "@/lib/duration";

const PALETTE = ["#22c55e", "#5b8cff", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6", "#ec4899", "#64748b"];

type Item = { id: string; text: string; isChecked: boolean; assigneeId: string | null; dueDate: string | null };
type Checklist = { id: string; title: string; items: Item[] };
type Lbl = { id: string; name: string | null; color: string };
type Comment = { id: string; body: string; origin: string; author: string | null; userId: string | null; createdAt: string; editedAt: string | null };
type Member = { id: string; name: string; isMind: boolean };
type Attachment = { id: string; name: string; url: string | null; createdAt: string;
  storageKey?: string | null; sizeBytes?: number | null; mime?: string | null };
type Detail = {
  id: string; title: string; description: string | null; startDate: string | null; dueDate: string | null;
  isComplete: boolean; cover: string | null; origin: string; listId: string; resolution: string | null;
  issueKey: string | null; issueType: string; priority: string; points: number | null;
  parentId: string | null; assigneeId: string | null; reporterId: string | null;
  watchers: { id: string; name: string }[];
  fixVersions: { id: string; name: string }[]; components: { id: string; name: string }[];
  originalEstimate: number | null; remainingEstimate: number | null; timeSpent: number;
  workLogs: { id: string; minutes: number; comment: string | null; startedAt: string; userId: string | null; author: string | null }[];
  fields: Record<string, unknown>;
  checklists: Checklist[]; labels: Lbl[]; comments: Comment[]; members: Member[];
  attachments: Attachment[]; activity: ActivityRow[]; links: LinkRow[];
  viewer: { id: string; role: string | null };
};
type BCard = {
  id: string; title: string; issueKey: string | null; issueType: string;
  parentId: string | null; points: number | null; isComplete: boolean;
};
type BoardRef = { id: string; title: string };
type LinkRow = {
  id: string; type: string; direction: "outward" | "inward"; label: string;
  card: { id: string; issueKey: string | null; title: string; isComplete: boolean; issueType: string; boardId: string };
};
type SearchHit = { id: string; title: string; issueKey: string | null; boardId: string };
type CustomField = { id: string; name: string; type: "text" | "number" | "select" | "date" | "user" | "checkbox"; options: string[] | null };
// What the picker offers. "is blocked by" is created from the other card as "blocks", so it needs
// write access on that card's board — the server says so if not.
const LINK_CHOICES = [
  { value: "blocks", label: "blocks", reverse: false },
  { value: "blocked-by", label: "is blocked by", reverse: true },
  { value: "relates", label: "relates to", reverse: false },
  { value: "duplicates", label: "duplicates", reverse: false },
  { value: "clones", label: "clones", reverse: false },
] as const;
type ListRef = { id: string; title: string };

const TYPES = ["epic", "story", "task", "bug", "subtask"];
const PRIOS = ["highest", "high", "medium", "low", "lowest"];
const TYPE_MARK: Record<string, string> = { epic: "E", story: "S", task: "T", bug: "B", subtask: "·" };
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i;
// An attachment is either a link someone pasted or a file we are storing; the two are read
// differently but shown the same way.
const attHref = (a: { id: string; url: string | null; storageKey?: string | null }) =>
  a.storageKey ? `/api/attachments/${a.id}/file` : a.url;
// SVG is an image to a person but a script to a browser, so it is never rendered inline here — the
// upload route refuses to serve it as SVG for the same reason.
const attIsImage = (a: { url: string | null; storageKey?: string | null; mime?: string | null }) =>
  a.storageKey ? /^image\/(png|jpe?g|gif|webp|avif)$/i.test(a.mime ?? "") : Boolean(a.url && IMAGE.test(a.url));
const fileSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

const json = (method: string, body?: unknown): RequestInit => ({
  method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const day = (v: string | null) => (v ? v.slice(0, 10) : "");

function initials(name: string) {
  return name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

/** Every card beneath `id` — used to keep the parent picker from creating a cycle. */
function descendants(id: string, all: BCard[]): Set<string> {
  const out = new Set<string>();
  const walk = (pid: string) => {
    for (const c of all) {
      if (c.parentId === pid && !out.has(c.id)) { out.add(c.id); walk(c.id); }
    }
  };
  walk(id);
  return out;
}

export function CardModal({ cardId, boardId, onClose, onChange, canEdit = true }:
  { cardId: string; boardId: string; onClose: () => void; onChange?: (id: string, patch: { title?: string; labels?: Lbl[] }) => void; canEdit?: boolean }) {
  const [c, setC] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [boardLabels, setBoardLabels] = useState<Lbl[]>([]);
  const [allUsers, setAllUsers] = useState<Member[]>([]);
  const [boardCards, setBoardCards] = useState<BCard[]>([]);
  const [boardVersions, setBoardVersions] = useState<{ id: string; name: string; releasedAt: string | null; isArchived: boolean }[]>([]);
  const [boardComponents, setBoardComponents] = useState<{ id: string; name: string }[]>([]);
  const [boardFields, setBoardFields] = useState<CustomField[]>([]);
  const [comment, setComment] = useState("");
  const [showDetails, setShowDetails] = useState(true);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [managingLabels, setManagingLabels] = useState(false);
  const [editingComment, setEditingComment] = useState<{ id: string; body: string } | null>(null);
  const [hideChecked, setHideChecked] = useState(false);
  const [panel, setPanel] = useState<null | "attach" | "cover" | "move" | "link" | "log">(null);
  const [attachUrl, setAttachUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [attachName, setAttachName] = useState("");
  const [moveBoards, setMoveBoards] = useState<BoardRef[]>([]);
  const [moveBoard, setMoveBoard] = useState(boardId);
  const [moveLists, setMoveLists] = useState<ListRef[]>([]);
  const [moveList, setMoveList] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [linkType, setLinkType] = useState<(typeof LINK_CHOICES)[number]["value"]>("blocks");
  const [linkQuery, setLinkQuery] = useState("");
  const [linkHits, setLinkHits] = useState<SearchHit[]>([]);
  const [childTitle, setChildTitle] = useState("");
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [logDraft, setLogDraft] = useState({ spent: "", remaining: "", comment: "" });

  const load = useCallback(async () => {
    const r = await fetch(`/api/cards/${cardId}`);
    if (!r.ok) { setMissing(true); return; }
    setC(await r.json());
  }, [cardId]);

  useEffect(() => {
    load();
    fetch(`/api/labels?boardId=${boardId}`).then((r) => (r.ok ? r.json() : [])).then(setBoardLabels);
    fetch(`/api/users`).then((r) => (r.ok ? r.json() : [])).then(setAllUsers);
    fetch(`/api/boards/${boardId}`).then((r) => (r.ok ? r.json() : { cards: [] }))
      .then((d: { cards?: BCard[]; versions?: typeof boardVersions; components?: typeof boardComponents; customFields?: CustomField[] }) => {
        setBoardCards(d.cards || []);
        setBoardVersions(d.versions || []);
        setBoardComponents(d.components || []);
        setBoardFields(d.customFields || []);
      });
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [cardId, boardId, onClose, load]);

  // Debounced search across every board the viewer can see, for the link picker.
  useEffect(() => {
    if (panel !== "link" || linkQuery.trim().length < 2) { setLinkHits([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(linkQuery.trim())}`);
      if (r.ok) setLinkHits(((await r.json()).cards as SearchHit[]).filter((h) => h.id !== cardId).slice(0, 8));
    }, 200);
    return () => clearTimeout(t);
  }, [linkQuery, panel, cardId]);

  if (missing) {
    return (
      <div className="modal-bg" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-top"><b style={{ flex: 1 }}>This card no longer exists, or you can&apos;t see it.</b>
            <button className="mini" onClick={onClose}>✕</button></div>
        </div>
      </div>
    );
  }
  if (!c) return <div className="modal-bg" onClick={onClose}><div className="modal">Loading…</div></div>;

  /** Run a write, surface a refusal, and re-read the card so fields and history stay true. */
  async function send(url: string, init: RequestInit) {
    setError(null);
    const r = await fetch(url, init);
    if (!r.ok) setError((await r.json().catch(() => ({}))).error || `That change was refused (${r.status}).`);
    await load();
    return r;
  }
  const patch = (body: Record<string, unknown>) => send(`/api/cards/${cardId}`, json("PATCH", body));

  async function toggleLabel(l: Lbl) {
    const on = c!.labels.some((x) => x.id === l.id);
    await send(`/api/cards/${cardId}/labels`, json(on ? "DELETE" : "POST", { labelId: l.id }));
    onChange?.(cardId, { labels: on ? c!.labels.filter((x) => x.id !== l.id) : [...c!.labels, l] });
  }
  async function newLabel(color: string) {
    const r = await fetch("/api/labels", json("POST", { boardId, color }));
    if (!r.ok) return;
    const l: Lbl = await r.json();
    setBoardLabels((ls) => [...ls, l]);
    toggleLabel(l);
  }
  async function updateLabel(l: Lbl, change: Partial<Lbl>) {
    const r = await fetch(`/api/labels/${l.id}`, json("PATCH", change));
    if (r.ok) { const next: Lbl = await r.json(); setBoardLabels((ls) => ls.map((x) => (x.id === l.id ? next : x))); load(); }
  }
  async function deleteLabel(l: Lbl) {
    if (!confirm(`Delete the ${l.name ? `"${l.name}"` : "colour"} label from the whole board? It is removed from every card.`)) return;
    const r = await fetch(`/api/labels/${l.id}`, json("DELETE"));
    if (r.ok) { setBoardLabels((ls) => ls.filter((x) => x.id !== l.id)); load(); }
  }
  const toggleMember = (u: Member) =>
    send(`/api/cards/${cardId}/members`, json(c!.members.some((m) => m.id === u.id) ? "DELETE" : "POST", { userId: u.id }));

  async function addChecklist() {
    const title = prompt("Checklist title", "Checklist");
    if (title?.trim()) await send("/api/checklists", json("POST", { cardId, title }));
  }
  const addItem = (clId: string, text: string) => send("/api/checklist-items", json("POST", { checklistId: clId, text }));
  const patchItem = (it: Item, body: Record<string, unknown>) => send(`/api/checklist-items/${it.id}`, json("PATCH", body));

  async function addComment() {
    if (!comment.trim()) return;
    const r = await send("/api/comments", json("POST", { cardId, body: comment }));
    if (r.ok) setComment("");
  }

  // One path for the file picker and for a drop on the card: the browser gives us a File either way.
  async function uploadFiles(files: FileList | File[] | null) {
    if (!files || !files.length || uploading) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.set("cardId", cardId);
      form.set("file", file);
      const r = await fetch("/api/attachments/upload", { method: "POST", body: form });
      if (!r.ok) {
        setError((await r.json().catch(() => ({}))).error || `Could not upload ${file.name}.`);
        break;
      }
    }
    setUploading(false);
    setPanel(null);
    load();
  }

  async function addAttachment() {
    const r = await send("/api/attachments", json("POST", { cardId, url: attachUrl.trim(), name: attachName.trim() || undefined }));
    if (r.ok) { setAttachUrl(""); setAttachName(""); setPanel(null); }
  }

  async function copyCard() {
    const title = prompt("Title for the copy", `${c!.title} (copy)`);
    if (title === null) return;
    const r = await fetch(`/api/cards/${cardId}/copy`, json("POST", { title }));
    if (!r.ok) setError((await r.json().catch(() => ({}))).error || "Copy was refused.");
  }

  async function openMove() {
    setPanel("move");
    const r = await fetch("/api/boards");
    const bs: BoardRef[] = r.ok ? await r.json() : [];
    setMoveBoards(bs);
    pickMoveBoard(boardId);
  }
  async function pickMoveBoard(id: string) {
    setMoveBoard(id);
    const r = await fetch(`/api/boards/${id}`);
    const ls: ListRef[] = r.ok ? (await r.json()).lists : [];
    setMoveLists(ls);
    setMoveList(ls.find((l) => l.id === c!.listId)?.id ?? ls[0]?.id ?? "");
  }
  async function doMove() {
    if (!moveList) return;
    const r = await fetch(`/api/cards/${cardId}/move`, json("POST", { listId: moveList }));
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error || "Move was refused."); return; }
    if (moveBoard !== boardId) onClose();   // it has left this board
    else { setPanel(null); load(); }
  }

  async function addLink(target: SearchHit) {
    const choice = LINK_CHOICES.find((l) => l.value === linkType)!;
    const type = choice.reverse ? "blocks" : choice.value;
    const [from, to] = choice.reverse ? [target.id, cardId] : [cardId, target.id];
    const r = await send(`/api/cards/${from}/links`, json("POST", { targetId: to, type }));
    if (r.ok) { setLinkQuery(""); setLinkHits([]); setPanel(null); }
  }

  async function addChild() {
    if (!childTitle.trim()) return;
    // Jira's hierarchy: an epic holds stories, anything else holds subtasks.
    const issueType = c!.issueType === "epic" ? "story" : "subtask";
    const r = await send("/api/cards", json("POST", { listId: c!.listId, title: childTitle.trim(), issueType, parentId: cardId }));
    if (r.ok) {
      setChildTitle("");
      const b = await fetch(`/api/boards/${boardId}`);
      if (b.ok) setBoardCards((await b.json()).cards || []);
    }
  }

  const watching = c.watchers.some((w) => w.id === c.viewer.id);
  const toggleWatch = () => send(`/api/cards/${cardId}/watch`, json(watching ? "DELETE" : "POST"));

  /** Insert the picked person as a mention token in place of the "@partial" being typed. */
  function pickMention(u: Member) {
    if (!mention) return;
    const caretEnd = mention.start + 1 + mention.query.length;
    const next = `${comment.slice(0, mention.start)}${mentionToken(u.name, u.id)} ${comment.slice(caretEnd)}`;
    setComment(next);
    setMention(null);
  }

  async function logWork() {
    const r = await send(`/api/cards/${cardId}/worklog`, json("POST", {
      spent: logDraft.spent, remaining: logDraft.remaining || undefined, comment: logDraft.comment || undefined,
    }));
    if (r.ok) { setLogDraft({ spent: "", remaining: "", comment: "" }); setPanel(null); }
  }

  async function archive() {
    const r = await fetch(`/api/cards/${cardId}`, json("PATCH", { isArchived: true }));
    if (r.ok) onClose();
  }
  async function destroy() {
    if (!confirm(`Delete ${c!.issueKey ?? "this card"} permanently? Archive it instead if you might want it back.`)) return;
    const r = await fetch(`/api/cards/${cardId}`, json("DELETE"));
    if (r.ok) onClose();
  }

  const isAdmin = c.viewer.role === "owner" || c.viewer.role === "admin";
  const due = dueState(c.dueDate, c.isComplete);
  const coverAttachment = c.cover && !c.cover.startsWith("#") ? c.attachments.find((a) => a.id === c.cover) : null;

  return (
    <div className="modal-bg" onClick={onClose}>
      {/* Dropping a file anywhere on the card attaches it, as Trello does. dragOver must be
          cancelled or the browser navigates to the file instead. */}
      <div className={`modal wide${dropping ? " dropping" : ""}`} onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => { if (canEdit && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDropping(true); } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false); }}
        onDrop={(e) => {
          if (!canEdit || !e.dataTransfer.files.length) return;
          e.preventDefault(); setDropping(false); uploadFiles(e.dataTransfer.files);
        }}>
        {dropping && <div className="dropnote">Drop to attach</div>}
        {c.cover?.startsWith("#") && <div className="mcover" style={{ background: c.cover }} />}
        {coverAttachment && attHref(coverAttachment) && (
          <div className="mcover img" style={{ backgroundImage: `url("${encodeURI(attHref(coverAttachment)!)}")` }} />
        )}

        <div className="modal-top">
          {c.origin === "mind" && <span className="badge">mind</span>}
          <input className="mtitle" defaultValue={c.title} readOnly={!canEdit} aria-label="Card title"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== c.title) { patch({ title: v }); onChange?.(cardId, { title: v }); }
            }} />
          <button className={`mini${watching ? " active" : ""}`} onClick={toggleWatch} aria-pressed={watching}
            title={c.watchers.length ? `Watching: ${c.watchers.map((w) => w.name).join(", ")}` : "No one is watching"}>
            👁 {watching ? "Watching" : "Watch"}{c.watchers.length ? ` · ${c.watchers.length}` : ""}
          </button>
          <button className="mini" onClick={() => navigator.clipboard?.writeText(`${location.origin}/b/${boardId}?card=${cardId}`)}
            title="Copy a link to this card">🔗</button>
          <button className="mini" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {error && <div className="bnote warn" style={{ margin: "8px 0 0", cursor: "default" }} onClick={() => setError(null)}>{error}</div>}

        <div className="mgrid">
          <div className="mmain">
            {/* A disabled fieldset disables every input, select, textarea and button inside it natively, so
                read-only is enforced by the browser rather than by remembering a flag on each control. */}
            <fieldset className="mfield" disabled={!canEdit}>
              <div className="msec"><div className="issrow">
                {c.issueKey && <span className="ikeybig">{c.issueKey}</span>}
                <select aria-label="Issue type" value={c.issueType} onChange={(e) => patch({ issueType: e.target.value })}>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select aria-label="Priority" value={c.priority} onChange={(e) => patch({ priority: e.target.value })}>
                  {PRIOS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input type="number" min={0} placeholder="pts" aria-label="Story points" style={{ width: 64 }} defaultValue={c.points ?? ""}
                  onBlur={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); if (v !== c.points) patch({ points: v }); }} />
                {/* Parent (epic/story). Self and everything beneath it are excluded so you can't build a cycle. */}
                <select aria-label="Parent" value={c.parentId ?? ""} onChange={(e) => patch({ parentId: e.target.value || null })}>
                  <option value="">no parent</option>
                  {(() => {
                    const banned = descendants(c.id, boardCards);
                    return boardCards
                      .filter((b) => b.id !== c.id && !banned.has(b.id) && (b.issueType === "epic" || b.issueType === "story"))
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {TYPE_MARK[b.issueType]} {b.issueKey ? b.issueKey + " " : ""}{b.title.slice(0, 40)}
                        </option>
                      ));
                  })()}
                </select>
              </div>

              {/* Children rollup — an epic/story is only as done as the work beneath it. */}
              {(() => {
                const kids = boardCards.filter((b) => b.parentId === c.id);
                if (!kids.length && c.issueType === "subtask") return null;
                const done = kids.filter((k) => k.isComplete);
                const totalPts = kids.reduce((s, k) => s + (k.points || 0), 0);
                const donePts = done.reduce((s, k) => s + (k.points || 0), 0);
                const pct = !kids.length ? 0 : totalPts > 0 ? (donePts / totalPts) * 100 : (done.length / kids.length) * 100;
                return (
                  <div style={{ marginTop: 10 }}>
                    <div className="mlabel">
                      {c.issueType === "epic" ? "Issues in this epic" : "Child issues"}
                      {kids.length > 0 && <> — {done.length}/{kids.length} done{totalPts > 0 && <> · {donePts}/{totalPts} pts</>}</>}
                    </div>
                    {kids.length > 0 && <div className="rollup"><div style={{ width: `${pct}%` }} /></div>}
                    <div className="kids">
                      {kids.map((k) => (
                        <a key={k.id} href={`/b/${boardId}?card=${k.id}`} className={`kid ${k.isComplete ? "done" : ""}`}>
                          <span className={`itype ${k.issueType}`}>{TYPE_MARK[k.issueType]}</span>
                          {k.issueKey && <span className="ikey">{k.issueKey}</span>}
                          <span className="btitle">{k.title}</span>
                          {k.points != null && <span className="pts">{k.points}</span>}
                        </a>
                      ))}
                      {c.issueType !== "subtask" && (
                        <input className="citem-add" placeholder={c.issueType === "epic" ? "+ Add a story to this epic…" : "+ Add a subtask…"}
                          value={childTitle} onChange={(e) => setChildTitle(e.target.value)} aria-label="New child issue"
                          onKeyDown={(e) => { if (e.key === "Enter") addChild(); }} />
                      )}
                    </div>
                  </div>
                );
              })()}
              </div>

              {c.links.length > 0 && (
                <div className="msec">
                  <div className="mlabel">Linked issues</div>
                  {Object.entries(c.links.reduce<Record<string, LinkRow[]>>((g, l) => ((g[l.label] ||= []).push(l), g), {})).map(([label, rows]) => (
                    <div key={label} className="linkgroup">
                      <div className="linklabel">{label}</div>
                      {rows.map((l) => (
                        <div key={l.id} className={`kid ${l.card.isComplete ? "done" : ""}`}>
                          <span className={`itype ${l.card.issueType}`}>{TYPE_MARK[l.card.issueType]}</span>
                          <a href={`/b/${l.card.boardId}?card=${l.card.id}`} className="ikey">{l.card.issueKey ?? "open"}</a>
                          <span className="btitle">{l.card.title}</span>
                          {l.card.boardId !== boardId && <span className="muted" style={{ fontSize: 10 }}>other board</span>}
                          <button className="mini" aria-label={`Remove link to ${l.card.issueKey ?? l.card.title}`}
                            onClick={() => send(`/api/issue-links/${l.id}`, json("DELETE"))}>✕</button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              <div className="mrow2">
                <div className="msec">
                  <div className="mlabel">Assignee</div>
                  <div className="issrow">
                    <select aria-label="Assignee" value={c.assigneeId ?? ""} onChange={(e) => patch({ assigneeId: e.target.value || null })}>
                      <option value="">Unassigned</option>
                      {allUsers.map((u) => <option key={u.id} value={u.id}>{u.isMind ? "🧠 " : ""}{u.name}</option>)}
                    </select>
                    {c.assigneeId !== c.viewer.id && allUsers.some((u) => u.id === c.viewer.id) && (
                      <button className="linkbtn" onClick={() => patch({ assigneeId: c.viewer.id })}>Assign to me</button>
                    )}
                  </div>
                </div>
                <div className="msec">
                  <div className="mlabel">Reporter</div>
                  <select aria-label="Reporter" value={c.reporterId ?? ""} onChange={(e) => patch({ reporterId: e.target.value || null })}
                    className="plainsel">
                    <option value="">—</option>
                    {allUsers.map((u) => <option key={u.id} value={u.id}>{u.isMind ? "🧠 " : ""}{u.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="mrow2">
                <div className="msec">
                  <div className="mlabel">Members</div>
                  <div className="mrow">
                    {allUsers.map((u) => {
                      const on = c.members.some((m) => m.id === u.id);
                      return (
                        <button key={u.id} className="avatar" title={`${on ? "Unassign" : "Assign"} ${u.name}`} aria-pressed={on}
                          onClick={() => toggleMember(u)}
                          style={{ opacity: on ? 1 : 0.35, background: u.isMind ? "#5b8cff" : "#2a3346" }}>
                          {u.isMind ? "🧠" : initials(u.name)}
                        </button>);
                    })}
                  </div>
                </div>

                <div className="msec">
                  <div className="mlabel">
                    Labels
                    <button className="mini" type="button" onClick={() => setManagingLabels((v) => !v)}>{managingLabels ? "Done" : "Edit"}</button>
                  </div>
                  {!managingLabels ? (
                    <div className="mrow">
                      {boardLabels.map((l) => {
                        const on = c.labels.some((x) => x.id === l.id);
                        return (
                          <button key={l.id} className="chip" aria-pressed={on} title={on ? "Remove label" : "Add label"}
                            style={{ background: l.color, opacity: on ? 1 : 0.35 }} onClick={() => toggleLabel(l)}>{l.name || " "}</button>
                        );
                      })}
                      {!boardLabels.length && <span className="muted" style={{ fontSize: 12 }}>No labels yet — Edit to create one.</span>}
                    </div>
                  ) : (
                    <div className="lblmgr">
                      {boardLabels.map((l) => (
                        <div key={l.id} className="lblrow">
                          <input className="lblname" defaultValue={l.name ?? ""} placeholder="(no name)" aria-label="Label name"
                            onBlur={(e) => { if ((e.target.value.trim() || null) !== l.name) updateLabel(l, { name: e.target.value }); }} />
                          <div className="swatches">
                            {PALETTE.map((col) => (
                              <button key={col} className={`sw ${l.color === col ? "on" : ""}`} style={{ background: col }}
                                aria-label={`Colour ${col}`} onClick={() => updateLabel(l, { color: col })} />
                            ))}
                          </div>
                          <button className="mini" onClick={() => deleteLabel(l)} aria-label={`Delete label ${l.name ?? l.color}`}>🗑</button>
                        </div>
                      ))}
                      <div className="lblrow">
                        <span className="muted" style={{ fontSize: 12 }}>New label:</span>
                        <div className="swatches">
                          {PALETTE.map((col) => (
                            <button key={col} className="sw" style={{ background: col }} aria-label={`New ${col} label`} onClick={() => newLabel(col)} />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {(boardVersions.length > 0 || boardComponents.length > 0) && (
                <div className="mrow2">
                  <div className="msec">
                    <div className="mlabel">Fix versions <a className="linkbtn" href={`/b/${boardId}/releases`}>manage</a></div>
                    <div className="mrow">
                      {boardVersions.filter((v) => !v.isArchived).map((v) => {
                        const on = c.fixVersions.some((x) => x.id === v.id);
                        return (
                          <button key={v.id} className={`fchip${on ? " on" : ""}`} aria-pressed={on}
                            onClick={() => send(`/api/cards/${cardId}/fix-versions`, json(on ? "DELETE" : "POST", { versionId: v.id }))}>
                            {v.name}{v.releasedAt ? " ✓" : ""}
                          </button>
                        );
                      })}
                      {!boardVersions.length && <span className="muted" style={{ fontSize: 12 }}>No versions on this board.</span>}
                    </div>
                  </div>
                  <div className="msec">
                    <div className="mlabel">Components</div>
                    <div className="mrow">
                      {boardComponents.map((co) => {
                        const on = c.components.some((x) => x.id === co.id);
                        return (
                          <button key={co.id} className={`fchip${on ? " on" : ""}`} aria-pressed={on}
                            onClick={() => send(`/api/cards/${cardId}/components`, json(on ? "DELETE" : "POST", { componentId: co.id }))}>
                            {co.name}
                          </button>
                        );
                      })}
                      {!boardComponents.length && <span className="muted" style={{ fontSize: 12 }}>No components on this board.</span>}
                    </div>
                  </div>
                </div>
              )}

              <div className="msec">
                <div className="mlabel">Dates</div>
                <div className="issrow">
                  <label className="dfield">Start
                    <input type="date" value={day(c.startDate)} onChange={(e) => patch({ startDate: e.target.value || null })} />
                  </label>
                  <label className="dfield">Due
                    <input type="date" value={day(c.dueDate)} onChange={(e) => patch({ dueDate: e.target.value || null })} />
                  </label>
                  <label className="dfield inline">
                    <input type="checkbox" checked={c.isComplete} onChange={(e) => patch({ isComplete: e.target.checked })} />
                    Complete
                  </label>
                  {c.isComplete && (
                    <label className="dfield">Resolution
                      <select className="plainsel" aria-label="Resolution" value={c.resolution ?? "done"} onChange={(e) => patch({ resolution: e.target.value })}>
                        <option value="done">Done</option>
                        <option value="wont_do">Won&apos;t do</option>
                        <option value="duplicate">Duplicate</option>
                        <option value="cannot_reproduce">Cannot reproduce</option>
                      </select>
                    </label>
                  )}
                  {due && <span className={`duebadge ${due}`}>{dueLabel(due)}</span>}
                </div>
              </div>

              {boardFields.length > 0 && (
                <div className="msec">
                  <div className="mlabel">Fields <a className="linkbtn" href={`/b/${boardId}?settings=fields`}>manage</a></div>
                  <div className="cfgrid">
                    {boardFields.map((f) => {
                      const value = c.fields[f.id];
                      const save = (v: unknown) => send(`/api/cards/${cardId}/fields`, json("PUT", { fieldId: f.id, value: v }));
                      return (
                        <label key={f.id} className="dfield cfrow">
                          {f.name}
                          {f.type === "select" ? (
                            <select className="plainsel" aria-label={f.name} value={(value as string) ?? ""} onChange={(e) => save(e.target.value || null)}>
                              <option value="">—</option>
                              {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : f.type === "user" ? (
                            <select className="plainsel" aria-label={f.name} value={(value as string) ?? ""} onChange={(e) => save(e.target.value || null)}>
                              <option value="">—</option>
                              {allUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                            </select>
                          ) : f.type === "checkbox" ? (
                            <input type="checkbox" aria-label={f.name} checked={value === true} onChange={(e) => save(e.target.checked)} />
                          ) : f.type === "date" ? (
                            <input type="date" aria-label={f.name} value={typeof value === "string" ? value.slice(0, 10) : ""}
                              onChange={(e) => save(e.target.value || null)} />
                          ) : (
                            <input type={f.type === "number" ? "number" : "text"} aria-label={f.name}
                              defaultValue={value == null ? "" : String(value)}
                              onBlur={(e) => {
                                const raw = e.target.value.trim();
                                const next = raw === "" ? null : f.type === "number" ? Number(raw) : raw;
                                if (String(next ?? "") !== String(value ?? "")) save(next);
                              }} />
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="msec">
                <div className="mlabel">Time tracking</div>
                <div className="issrow">
                  <label className="dfield">Original estimate
                    <input defaultValue={c.originalEstimate != null ? formatDuration(c.originalEstimate) : ""} placeholder="e.g. 1d 4h" aria-label="Original estimate"
                      style={{ width: 110 }}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v !== (c.originalEstimate != null ? formatDuration(c.originalEstimate) : "")) patch({ originalEstimate: v || null }); }} />
                  </label>
                  <label className="dfield">Remaining
                    <input defaultValue={c.remainingEstimate != null ? formatDuration(c.remainingEstimate) : ""} placeholder="—" aria-label="Remaining estimate"
                      style={{ width: 110 }}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v !== (c.remainingEstimate != null ? formatDuration(c.remainingEstimate) : "")) patch({ remainingEstimate: v || null }); }} />
                  </label>
                  <div className="dfield">Logged<span className="timeval">{formatDuration(c.timeSpent)}</span></div>
                  <button className="linkbtn" type="button" onClick={() => setPanel(panel === "log" ? null : "log")}>Log work</button>
                </div>
                {(c.timeSpent > 0 || c.remainingEstimate != null) && (() => {
                  // Jira's bar: logged against logged + remaining, so it fills as the work is done.
                  const total = c.timeSpent + (c.remainingEstimate ?? 0);
                  const pct = total ? Math.round((c.timeSpent / total) * 100) : 0;
                  return (
                    <div className="clprog" title={`${formatDuration(c.timeSpent)} logged, ${c.remainingEstimate != null ? formatDuration(c.remainingEstimate) : "no"} remaining`}>
                      <div className="rollup" style={{ flex: 1, marginTop: 0 }}><div style={{ width: `${pct}%` }} /></div>
                      <span>{formatDuration(c.timeSpent)} / {formatDuration(total)}</span>
                    </div>
                  );
                })()}
                {panel === "log" && (
                  <div className="logform">
                    <input placeholder="Time spent, e.g. 2h 30m" value={logDraft.spent} aria-label="Time spent"
                      onChange={(e) => setLogDraft({ ...logDraft, spent: e.target.value })} />
                    <input placeholder="Remaining (optional)" value={logDraft.remaining} aria-label="Remaining after this"
                      onChange={(e) => setLogDraft({ ...logDraft, remaining: e.target.value })} />
                    <input placeholder="What did you do? (optional)" value={logDraft.comment} style={{ flex: 1 }} aria-label="Work description"
                      onChange={(e) => setLogDraft({ ...logDraft, comment: e.target.value })} onKeyDown={(e) => e.key === "Enter" && logWork()} />
                    <button className="btn" onClick={logWork} disabled={!logDraft.spent.trim()}>Log</button>
                  </div>
                )}
                {c.workLogs.length > 0 && (
                  <div className="loglist">
                    {c.workLogs.map((w) => (
                      <div key={w.id} className="logrow">
                        <span className="timeval">{formatDuration(w.minutes)}</span>
                        <b>{w.author ?? "Someone"}</b>
                        <span className="muted">{relativeTime(w.startedAt)}</span>
                        {w.comment && <span className="btitle">{w.comment}</span>}
                        {(w.userId === c.viewer.id || isAdmin) && (
                          <button className="mini" aria-label="Delete work log entry"
                            onClick={() => { if (confirm(`Remove ${formatDuration(w.minutes)} of logged work?`)) send(`/api/worklog/${w.id}`, json("DELETE")); }}>✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="msec">
                <div className="mlabel">
                  Description
                  {!editingDesc && <button className="mini" type="button" onClick={() => { setDescDraft(c.description ?? ""); setEditingDesc(true); }}>Edit</button>}
                </div>
                {editingDesc ? (
                  <>
                    <textarea rows={8} value={descDraft} onChange={(e) => setDescDraft(e.target.value)} style={{ width: "100%" }}
                      placeholder="Markdown supported: **bold**, lists, `code`, [links](https://…), tables, - [ ] tasks" autoFocus />
                    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                      <button className="btn" onClick={async () => { await patch({ description: descDraft }); setEditingDesc(false); }}>Save</button>
                      <button className="mini" onClick={() => setEditingDesc(false)}>Cancel</button>
                    </div>
                  </>
                ) : c.description?.trim() ? (
                  <div className="md" onDoubleClick={() => { if (canEdit) { setDescDraft(c.description ?? ""); setEditingDesc(true); } }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}
                      components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>
                      {mentionsToMarkdown(c.description)}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="muted" style={{ fontSize: 13 }}>No description.</div>
                )}
              </div>

              {c.attachments.length > 0 && (
                <div className="msec">
                  <div className="mlabel">Attachments</div>
                  {c.attachments.map((a) => (
                    <div key={a.id} className="attrow">
                      {attIsImage(a)
                        ? <span className="attthumb" style={{ backgroundImage: `url("${encodeURI(attHref(a)!)}")` }} />
                        : <span className="attthumb icon">{a.storageKey ? "📄" : "🔗"}</span>}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <a href={attHref(a)!} target="_blank" rel="noopener noreferrer" className="attname">{a.name}</a>
                        <div className="muted" style={{ fontSize: 11 }}>
                          added {relativeTime(a.createdAt)}
                          {a.sizeBytes != null && ` · ${fileSize(a.sizeBytes)}`}
                          {attIsImage(a) && (
                            c.cover === a.id
                              ? <> · <button className="linkbtn" onClick={() => patch({ cover: null })}>Remove cover</button></>
                              : <> · <button className="linkbtn" onClick={() => patch({ cover: a.id })}>Make cover</button></>
                          )}
                        </div>
                      </div>
                      <button className="mini" aria-label={`Remove ${a.name}`}
                        onClick={() => { if (confirm(`Remove "${a.name}"?`)) send(`/api/attachments/${a.id}`, json("DELETE")); }}>🗑</button>
                    </div>
                  ))}
                </div>
              )}

              {c.checklists.length > 0 && (
                <div className="msec">
                  <div className="mlabel">
                    Checklists
                    <button className="mini" type="button" onClick={() => setHideChecked((v) => !v)}>{hideChecked ? "Show checked" : "Hide checked"}</button>
                  </div>
                  {c.checklists.map((cl) => {
                    const done = cl.items.filter((i) => i.isChecked).length;
                    const pct = cl.items.length ? Math.round((done / cl.items.length) * 100) : 0;
                    return (
                      <div key={cl.id} className="clist">
                        <div className="clhead">
                          <input className="cltitle" defaultValue={cl.title} aria-label="Checklist title"
                            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== cl.title) send(`/api/checklists/${cl.id}`, json("PATCH", { title: v })); }} />
                          <button className="mini" aria-label={`Delete checklist ${cl.title}`}
                            onClick={() => { if (confirm(`Delete checklist "${cl.title}" and its ${cl.items.length} item(s)?`)) send(`/api/checklists/${cl.id}`, json("DELETE")); }}>Delete</button>
                        </div>
                        <div className="clprog"><span>{pct}%</span><div className="rollup" style={{ flex: 1, marginTop: 0 }}><div style={{ width: `${pct}%` }} /></div></div>
                        {cl.items.filter((it) => !(hideChecked && it.isChecked)).map((it) => (
                          <div key={it.id} className="citem">
                            <input type="checkbox" checked={it.isChecked} aria-label={`Complete ${it.text}`} onChange={() => patchItem(it, { isChecked: !it.isChecked })} />
                            <input className={`citext ${it.isChecked ? "done" : ""}`} defaultValue={it.text} aria-label="Item text"
                              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== it.text) patchItem(it, { text: v }); }} />
                            <select className="cisel" aria-label="Item assignee" value={it.assigneeId ?? ""}
                              onChange={(e) => patchItem(it, { assigneeId: e.target.value || null })}>
                              <option value="">—</option>
                              {allUsers.map((u) => <option key={u.id} value={u.id}>{initials(u.name)} {u.name}</option>)}
                            </select>
                            <input type="date" className="cidate" aria-label="Item due date" value={day(it.dueDate)}
                              onChange={(e) => patchItem(it, { dueDate: e.target.value || null })} />
                            <button className="mini" aria-label={`Delete item ${it.text}`} onClick={() => send(`/api/checklist-items/${it.id}`, json("DELETE"))}>✕</button>
                          </div>
                        ))}
                        <input placeholder="Add an item…" className="citem-add"
                          onKeyDown={(e) => { if (e.key === "Enter" && e.currentTarget.value.trim()) { addItem(cl.id, e.currentTarget.value.trim()); e.currentTarget.value = ""; } }} />
                      </div>
                    );
                  })}
                </div>
              )}
            </fieldset>

            {/* Outside the read-only fieldset: showing or hiding details is a view preference, not an edit,
                so an observer keeps it. Only the comment box is disabled for them. */}
            <div className="msec">
              <div className="mlabel">
                Activity
                <button className="mini" type="button" onClick={() => setShowDetails((v) => !v)}>
                  {showDetails ? "Hide details" : "Show details"}
                </button>
              </div>
              <fieldset className="mfield" disabled={!canEdit}>
                <div style={{ display: "flex", gap: 8, marginBottom: 10, position: "relative" }}>
                  <input placeholder={canEdit ? "Write a comment… type @ to mention" : "Observers can't comment"} value={comment}
                    onChange={(e) => { setComment(e.target.value); setMention(activeMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length)); }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape" && mention) { e.stopPropagation(); setMention(null); return; }
                      if (e.key === "Enter") {
                        const hits = mention ? allUsers.filter((u) => u.name.toLowerCase().includes(mention.query.toLowerCase())) : [];
                        if (mention && hits.length) { e.preventDefault(); pickMention(hits[0]); } else addComment();
                      }
                    }}
                    style={{ flex: 1 }} aria-label="New comment" />
                  <button className="btn" onClick={addComment}>Send</button>
                  {mention && (
                    <div className="mentionpick" role="listbox" aria-label="Mention someone">
                      {allUsers.filter((u) => u.name.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 6).map((u) => (
                        <button key={u.id} role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); pickMention(u); }}>
                          {u.isMind ? "🧠" : initials(u.name)} {u.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </fieldset>
              {(() => {
                // Comments always show; field-level history only with details on, as in Trello. A
                // comment's own history row is skipped because the comment itself is already listed.
                type Entry = { key: string; at: string; node: React.ReactNode };
                const entries: Entry[] = c.comments.map((cm) => {
                  const mine = cm.userId === c.viewer.id && canEdit;
                  return {
                    key: `c-${cm.id}`, at: cm.createdAt,
                    node: (
                      <div className="cmt">
                        <b>{cm.origin === "mind" ? "🧠 Mind" : (cm.author || "Someone")}</b>
                        <span className="when">{relativeTime(cm.createdAt)}{cm.editedAt ? " (edited)" : ""}</span>
                        {editingComment?.id === cm.id ? (
                          <div>
                            <textarea rows={3} style={{ width: "100%", marginTop: 4 }} value={editingComment.body} aria-label="Edit comment"
                              onChange={(e) => setEditingComment({ id: cm.id, body: e.target.value })} autoFocus />
                            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                              <button className="btn" onClick={async () => {
                                const r = await send(`/api/comments/${cm.id}`, json("PATCH", { body: editingComment.body }));
                                if (r.ok) setEditingComment(null);
                              }}>Save</button>
                              <button className="mini" onClick={() => setEditingComment(null)}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="cbody">
                            {splitMentions(cm.body).map((p, i) => ("mention" in p
                              ? <span key={i} className={`mention${p.userId === c.viewer.id ? " me" : ""}`}>@{p.mention}</span>
                              : <span key={i}>{p.text}</span>))}
                          </div>
                        )}
                        {(mine || isAdmin) && editingComment?.id !== cm.id && (
                          <div className="cactions">
                            {mine && <button className="linkbtn" onClick={() => setEditingComment({ id: cm.id, body: cm.body })}>Edit</button>}
                            <button className="linkbtn" onClick={() => { if (confirm("Delete this comment?")) send(`/api/comments/${cm.id}`, json("DELETE")); }}>Delete</button>
                          </div>
                        )}
                      </div>
                    ),
                  };
                });
                if (showDetails) {
                  for (const a of c.activity || []) {
                    if (a.type === "comment_added") continue;
                    entries.push({
                      key: `a-${a.id}`, at: String(a.createdAt),
                      node: (
                        <div className="hist">
                          <b>{a.actorIsMind ? "🧠 Mind" : (a.actor || "Someone")}</b> {describeActivity(a, "card")}
                          <span className="when">{relativeTime(a.createdAt)}</span>
                        </div>
                      ),
                    });
                  }
                }
                entries.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
                if (!entries.length) return <div className="bempty">No activity yet.</div>;
                return entries.map((e) => <div key={e.key}>{e.node}</div>);
              })()}
            </div>
          </div>

          {canEdit && (
            <aside className="mside">
              <div className="mlabel">Add to card</div>
              <button className="sidebtn" onClick={addChecklist}>☑ Checklist</button>
              <button className="sidebtn" onClick={() => setPanel(panel === "attach" ? null : "attach")}>📎 Attachment</button>
              {panel === "attach" && (
                <div className="sidepanel">
                  <input ref={fileInput} type="file" multiple style={{ display: "none" }}
                    onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }} />
                  <button className="btn" disabled={uploading} onClick={() => fileInput.current?.click()}>
                    {uploading ? "Uploading…" : "Choose a file"}
                  </button>
                  <div className="muted" style={{ fontSize: 11 }}>…or drop one on the card. Up to 10MB.</div>
                  <input placeholder="https://…" value={attachUrl} onChange={(e) => setAttachUrl(e.target.value)} aria-label="Attachment link" />
                  <input placeholder="Name (optional)" value={attachName} onChange={(e) => setAttachName(e.target.value)} aria-label="Attachment name" />
                  <button className="btn" onClick={addAttachment} disabled={!attachUrl.trim()}>Attach</button>
                </div>
              )}
              <button className="sidebtn" onClick={() => setPanel(panel === "link" ? null : "link")}>⛓ Link issue</button>
              {panel === "link" && (
                <div className="sidepanel">
                  <select value={linkType} onChange={(e) => setLinkType(e.target.value as typeof linkType)} aria-label="Link type">
                    {LINK_CHOICES.map((l) => <option key={l.value} value={l.value}>this {l.label}…</option>)}
                  </select>
                  <input placeholder="Search title or key" value={linkQuery} onChange={(e) => setLinkQuery(e.target.value)} aria-label="Find issue to link" autoFocus />
                  {linkHits.map((h) => (
                    <button key={h.id} className="linkhit" onClick={() => addLink(h)}>
                      <span className="ikey">{h.issueKey ?? ""}</span> {h.title}
                    </button>
                  ))}
                  {linkQuery.trim().length >= 2 && !linkHits.length && <div className="muted" style={{ fontSize: 11 }}>No matches.</div>}
                </div>
              )}
              <button className="sidebtn" onClick={() => setPanel(panel === "cover" ? null : "cover")}>🎨 Cover</button>
              {panel === "cover" && (
                <div className="sidepanel">
                  <div className="swatches">
                    {PALETTE.map((col) => (
                      <button key={col} className={`sw big ${c.cover === col ? "on" : ""}`} style={{ background: col }}
                        aria-label={`Cover ${col}`} onClick={() => patch({ cover: col })} />
                    ))}
                  </div>
                  {c.cover && <button className="mini" onClick={() => patch({ cover: null })}>Remove cover</button>}
                  <div className="muted" style={{ fontSize: 11 }}>For an image cover, attach an image link and choose “Make cover”.</div>
                </div>
              )}

              <div className="mlabel" style={{ marginTop: 14 }}>Actions</div>
              <button className="sidebtn" onClick={openMove}>➜ Move</button>
              {panel === "move" && (
                <div className="sidepanel">
                  <select value={moveBoard} onChange={(e) => pickMoveBoard(e.target.value)} aria-label="Move to board">
                    {moveBoards.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
                  </select>
                  <select value={moveList} onChange={(e) => setMoveList(e.target.value)} aria-label="Move to list">
                    {moveLists.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                  </select>
                  {moveBoard !== boardId && <div className="muted" style={{ fontSize: 11 }}>Labels and sprint stay behind; the card gets that board&apos;s issue key.</div>}
                  <button className="btn" onClick={doMove} disabled={!moveList}>Move</button>
                </div>
              )}
              <button className="sidebtn" onClick={copyCard}>⧉ Copy</button>
              <button className="sidebtn" onClick={archive}>🗄 Archive</button>
              <button className="sidebtn danger" onClick={destroy}>🗑 Delete</button>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
