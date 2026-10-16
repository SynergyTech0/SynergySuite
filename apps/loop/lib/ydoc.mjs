// The shape of Loop's shared documents, used by the API (to start a new component with its
// template), the collaboration server (to keep each item's search text current) and the tests.
//
// Pages and the "rich" components hold a Tiptap (ProseMirror) document in the XML fragment
// "default", the field Tiptap's Collaboration extension uses. The other components hold a list of
// rows in the array "items", each row a Y.Map.
import * as Y from "yjs";

/** Component kinds, in the order the insert menu shows them. */
export const KINDS = [
  { id: "tasks", name: "Task list", rich: false, hint: "Tasks with an owner, a due date and a tick box" },
  { id: "checklist", name: "Checklist", rich: true, hint: "Things to tick off" },
  { id: "table", name: "Table", rich: true, hint: "Rows and columns anyone can fill in" },
  { id: "voting", name: "Voting table", rich: false, hint: "Options people vote for" },
  { id: "progress", name: "Progress tracker", rich: false, hint: "Items with a status and an owner" },
  { id: "qa", name: "Q&A", rich: false, hint: "Questions, answers and upvotes" },
  { id: "bullets", name: "Bulleted list", rich: true, hint: "A shared list" },
  { id: "numbered", name: "Numbered list", rich: true, hint: "A shared numbered list" },
  { id: "note", name: "Paragraph", rich: true, hint: "Shared text" },
];

export const KIND_IDS = KINDS.map((k) => k.id);

export function kindInfo(id) {
  return KINDS.find((k) => k.id === id) ?? null;
}

export const PROGRESS_STATUSES = ["not-started", "in-progress", "blocked", "done"];
export const STATUS_LABEL = { "not-started": "Not started", "in-progress": "In progress", blocked: "Blocked", done: "Done" };

function el(name, attrs, children = []) {
  const e = new Y.XmlElement(name);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (children.length) e.insert(0, children);
  return e;
}

function para(text = "") {
  const t = new Y.XmlText();
  if (text) t.insert(0, text);
  return el("paragraph", {}, [t]);
}

/** A new row for a structured component. */
export function newItem(kind, fields = {}) {
  const m = new Y.Map();
  m.set("id", fields.id ?? randomId());
  m.set("title", fields.title ?? "");
  if (kind === "tasks") {
    m.set("assignee", fields.assignee ?? "");
    m.set("due", fields.due ?? "");
    m.set("done", !!fields.done);
  } else if (kind === "voting") {
    m.set("notes", fields.notes ?? "");
    m.set("votes", new Y.Map());
  } else if (kind === "progress") {
    m.set("status", fields.status ?? "not-started");
    m.set("owner", fields.owner ?? "");
    m.set("notes", fields.notes ?? "");
  } else if (kind === "qa") {
    m.set("by", fields.by ?? "");
    m.set("votes", new Y.Map());
    m.set("answers", new Y.Array());
  }
  return m;
}

export function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Fills a brand-new document with the template for `kind` ("page" for a page). */
export function seed(doc, kind) {
  const frag = doc.getXmlFragment("default");
  const cell = (name, text = "") => el(name, { colspan: 1, rowspan: 1 }, [para(text)]);
  switch (kind) {
    case "page":
    case "note":
      frag.insert(0, [para()]);
      break;
    case "bullets":
      frag.insert(0, [el("bulletList", {}, [el("listItem", {}, [para()])])]);
      break;
    case "numbered":
      frag.insert(0, [el("orderedList", { start: 1 }, [el("listItem", {}, [para()])])]);
      break;
    case "checklist":
      frag.insert(0, [el("taskList", {}, [el("taskItem", { checked: false }, [para()])])]);
      break;
    case "table":
      frag.insert(0, [
        el("table", {}, [
          el("tableRow", {}, [cell("tableHeader", "Column 1"), cell("tableHeader", "Column 2"), cell("tableHeader", "Column 3")]),
          el("tableRow", {}, [cell("tableCell"), cell("tableCell"), cell("tableCell")]),
          el("tableRow", {}, [cell("tableCell"), cell("tableCell"), cell("tableCell")]),
        ]),
        para(),
      ]);
      break;
    case "voting":
      doc.getArray("items").push([newItem("voting", { title: "Option 1" }), newItem("voting", { title: "Option 2" })]);
      break;
    case "tasks":
    case "progress":
    case "qa":
      doc.getArray("items");
      break;
    default:
      throw new Error(`Unknown component kind: ${kind}`);
  }
}

/**
 * A new document for `kind`, as the update to store. A structured component can start with
 * `items` (plain objects with the row's fields) in place of its template rows.
 */
export function seededState(kind, items) {
  const doc = new Y.Doc();
  if (Array.isArray(items) && items.length && !kindInfo(kind)?.rich && kind !== "page") {
    doc.getArray("items").push(items.map((f) => newItem(kind, f)));
  } else {
    seed(doc, kind);
  }
  return Y.encodeStateAsUpdate(doc);
}

const BLOCKS = new Set(["paragraph", "heading", "codeBlock", "horizontalRule"]);

function walk(node, out, embeds, inCell = false) {
  if (node instanceof Y.XmlText) {
    for (const op of node.toDelta()) if (typeof op.insert === "string") out.push(op.insert);
    return;
  }
  if (!(node instanceof Y.XmlElement)) return;
  const name = node.nodeName;
  if (name === "loopComponent") {
    const id = node.getAttribute("componentId");
    if (typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)) embeds.add(id.toLowerCase());
    return;
  }
  if (name === "mention") {
    out.push(`@${node.getAttribute("label") || node.getAttribute("id") || ""}`);
    return;
  }
  if (name === "taskItem") out.push(node.getAttribute("checked") ? "[x] " : "[ ] ");
  const cell = inCell || name === "tableCell" || name === "tableHeader";
  for (const child of node.toArray()) walk(child, out, embeds, cell);
  if (BLOCKS.has(name)) out.push(inCell ? " " : "\n");
  else if (name === "tableCell" || name === "tableHeader") out.push(" | ");
  else if (name === "tableRow") out.push("\n");
}

function tidy(s) {
  return s
    .split("\n")
    .map((l) => (/^[\s|]*$/.test(l) ? "" : l.replace(/\s*\|\s*$/, "").replace(/[ \t]+/g, " ").trim()))
    .filter((l, i, all) => l || (i > 0 && all[i - 1]))
    .join("\n")
    .trim();
}

/** Plain text of a rich document, and the components it embeds. */
export function richText(doc) {
  const out = [];
  const embeds = new Set();
  for (const child of doc.getXmlFragment("default").toArray()) walk(child, out, embeds);
  return { text: tidy(out.join("")), embeds: [...embeds] };
}

function votes(m) {
  const v = m.get("votes");
  return v instanceof Y.Map ? [...v.keys()] : [];
}

/** The rows of a structured component as plain objects. */
export function itemsOf(doc) {
  return doc
    .getArray("items")
    .toArray()
    .filter((m) => m instanceof Y.Map)
    .map((m) => {
      const o = {};
      for (const [k, v] of m.entries()) {
        if (k === "votes") o.votes = votes(m);
        else if (k === "answers") o.answers = v instanceof Y.Array ? v.toArray().map((a) => (a instanceof Y.Map ? a.toJSON() : a)) : [];
        else o[k] = v;
      }
      return o;
    });
}

/** Plain text of any Loop document: what search, eDiscovery and exports see. */
export function docText(doc, kind) {
  const info = kindInfo(kind);
  if (kind === "page" || info?.rich) return richText(doc);
  const lines = [];
  for (const it of itemsOf(doc)) {
    const title = String(it.title ?? "").trim();
    if (kind === "tasks") {
      const extra = [it.assignee, it.due].filter(Boolean).join(", ");
      if (title || extra) lines.push(`${it.done ? "[x]" : "[ ]"} ${title}${extra ? ` (${extra})` : ""}`);
    } else if (kind === "voting") {
      if (title) lines.push(`${title}: ${it.votes.length} ${it.votes.length === 1 ? "vote" : "votes"}${it.votes.length ? ` (${it.votes.join(", ")})` : ""}`);
      if (it.notes) lines.push(`  ${it.notes}`);
    } else if (kind === "progress") {
      if (title) lines.push(`${title}: ${STATUS_LABEL[it.status] ?? it.status}${it.owner ? `, ${it.owner}` : ""}`);
      if (it.notes) lines.push(`  ${it.notes}`);
    } else if (kind === "qa") {
      if (title) lines.push(`Q: ${title}${it.by ? ` (${it.by})` : ""}`);
      for (const a of it.answers ?? []) if (a?.text) lines.push(`A: ${a.text}${a.by ? ` (${a.by})` : ""}`);
    }
  }
  return { text: lines.join("\n"), embeds: [] };
}

/** Plain text of a stored document update (null = never saved). */
export function storedText(state, kind) {
  if (!state || !state.length) return { text: "", embeds: [] };
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state instanceof Uint8Array ? state : new Uint8Array(state));
  return docText(doc, kind);
}
