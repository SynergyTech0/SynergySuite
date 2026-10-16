import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { KINDS, docText, itemsOf, newItem, seed, seededState, storedText } from "../lib/ydoc.mjs";
import { markdownToHtml } from "../lib/markdown";

function load(state: Uint8Array) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
}

describe("component documents", () => {
  it("starts every kind with its template", () => {
    for (const k of KINDS) expect(() => seededState(k.id)).not.toThrow();
    expect(() => seededState("nope")).toThrow(/Unknown component kind/);
    const table = load(seededState("table"));
    expect(docText(table, "table").text).toBe("Column 1 | Column 2 | Column 3");
    expect(itemsOf(load(seededState("voting"))).map((i) => i.title)).toEqual(["Option 1", "Option 2"]);
    expect(itemsOf(load(seededState("tasks")))).toEqual([]);
  });

  it("can start a structured component with rows of its own", () => {
    const doc = load(seededState("tasks", [{ title: "Book the venue", assignee: "bob@example.com", due: "2026-11-01" }]));
    expect(itemsOf(doc)).toMatchObject([{ title: "Book the venue", assignee: "bob@example.com", due: "2026-11-01", done: false }]);
    // Rich kinds ignore rows.
    expect(docText(load(seededState("checklist", [{ title: "x" }])), "checklist").text).toBe("[ ]");
  });

  it("reads a page's text and the components on it", () => {
    const doc = new Y.Doc();
    seed(doc, "page");
    const frag = doc.getXmlFragment("default");
    const p = new Y.XmlElement("paragraph");
    const t = new Y.XmlText();
    t.insert(0, "Launch ");
    t.insert(7, "plan", { bold: true });
    p.insert(0, [t]);
    const embed = new Y.XmlElement("loopComponent");
    embed.setAttribute("componentId", "0f8e7a1c-1111-4c3d-9a1b-2b3c4d5e6f70");
    const list = new Y.XmlElement("taskList");
    const item = new Y.XmlElement("taskItem");
    item.setAttribute("checked", true as unknown as string);
    const ip = new Y.XmlElement("paragraph");
    const it2 = new Y.XmlText();
    it2.insert(0, "Ship it");
    ip.insert(0, [it2]);
    item.insert(0, [ip]);
    list.insert(0, [item]);
    frag.insert(1, [p, embed, list]);
    const out = docText(doc, "page");
    expect(out.text).toBe("Launch plan\n[x] Ship it");
    expect(out.embeds).toEqual(["0f8e7a1c-1111-4c3d-9a1b-2b3c4d5e6f70"]);
    expect(storedText(Y.encodeStateAsUpdate(doc), "page")).toEqual(out);
    expect(storedText(null, "page")).toEqual({ text: "", embeds: [] });
  });

  it("writes the rows of each structured kind as text", () => {
    const tasks = new Y.Doc();
    tasks.getArray("items").push([newItem("tasks", { title: "Draft the post", assignee: "ann", due: "2026-10-20", done: true })]);
    expect(docText(tasks, "tasks").text).toBe("[x] Draft the post (ann, 2026-10-20)");

    const voting = new Y.Doc();
    const opt = newItem("voting", { title: "Tuesday", notes: "after standup" });
    voting.getArray("items").push([opt]);
    (opt.get("votes") as Y.Map<boolean>).set("a@x.com", true);
    expect(docText(voting, "voting").text).toBe("Tuesday: 1 vote (a@x.com)\n  after standup");

    const progress = new Y.Doc();
    progress.getArray("items").push([newItem("progress", { title: "Design", status: "in-progress", owner: "kim" })]);
    expect(docText(progress, "progress").text).toBe("Design: In progress, kim");

    const qa = new Y.Doc();
    const question = newItem("qa", { title: "Where do we meet?", by: "a@x.com" });
    qa.getArray("items").push([question]);
    const answer = new Y.Map<unknown>();
    answer.set("text", "Room 4");
    answer.set("by", "b@x.com");
    (question.get("answers") as Y.Array<Y.Map<unknown>>).push([answer]);
    expect(docText(qa, "qa").text).toBe("Q: Where do we meet? (a@x.com)\nA: Room 4 (b@x.com)");
  });
});

describe("Copilot markdown", () => {
  it("turns the answer into page HTML without letting it add markup", () => {
    expect(markdownToHtml("# Plan\nSome **bold** and _soft_ words\n- one\n- two\n1. first\n- [ ] call\n- [x] done\n<script>x</script>")).toBe(
      "<h2>Plan</h2><p>Some <strong>bold</strong> and <em>soft</em> words</p><ul><li><p>one</p></li><li><p>two</p></li></ul>" +
        "<ol><li><p>first</p></li></ol>" +
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>call</p></li><li data-type="taskItem" data-checked="true"><p>done</p></li></ul>' +
        "<p>&lt;script&gt;x&lt;/script&gt;</p>",
    );
  });
});
