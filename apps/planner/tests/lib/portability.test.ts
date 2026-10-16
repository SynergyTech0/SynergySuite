import { describe, expect, it } from "vitest";
import { toCsv, parseCsv } from "@/lib/csv";
import { readTrelloExport } from "@/lib/import-trello";
import { readJiraCsv } from "@/lib/import-jira-csv";

/**
 * FAILING-FIRST for getting data in and out.
 *
 * An import is the one place a user hands us a file we did not write, so the parsers are tested
 * against the shapes the real exports actually have — including the parts we deliberately drop.
 */

describe("csv", () => {
  it("quotes only what needs it and escapes embedded quotes", () => {
    const csv = toCsv([{ a: "plain", b: 'say "hi"', c: "with,comma", d: "line\nbreak", e: null }]);
    expect(csv.split("\n")[0]).toBe("a,b,c,d,e");
    expect(csv).toContain('plain,"say ""hi""","with,comma","line\nbreak",');
  });

  it("round-trips values that contain the separators", () => {
    const rows = [{ title: 'He said "go, now"', body: "two\nlines" }, { title: "plain", body: "" }];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it("reads a file saved by Excel: CRLF endings and a UTF-8 BOM", () => {
    const rows = parseCsv('﻿Summary,Status\r\n"Fix login",Done\r\n');
    expect(rows).toEqual([{ Summary: "Fix login", Status: "Done" }]);
  });
});

describe("Trello export", () => {
  const trello = {
    name: "Product",
    closed: false,
    labels: [{ id: "l1", name: "bug", color: "red" }, { id: "l2", name: "", color: "sky" }],
    lists: [
      { id: "L1", name: "To Do", closed: false, pos: 65535 },
      { id: "L2", name: "Done", closed: false, pos: 131071 },
      { id: "L3", name: "Old", closed: true, pos: 5 },
    ],
    cards: [
      {
        id: "c1", name: "Ship it", desc: "with a body", closed: false, idList: "L1", pos: 1024,
        due: "2026-10-01T00:00:00.000Z", dueComplete: false, idLabels: ["l1"],
        idChecklists: ["k1"], labels: [],
      },
      { id: "c2", name: "Done thing", desc: "", closed: false, idList: "L2", pos: 2048, due: null, idLabels: [] },
      { id: "c3", name: "Archived", desc: "", closed: true, idList: "L1", pos: 3072, idLabels: [] },
    ],
    checklists: [
      { id: "k1", name: "Steps", idCard: "c1", checkItems: [
        { id: "i1", name: "first", state: "complete", pos: 1 },
        { id: "i2", name: "second", state: "incomplete", pos: 2 },
      ] },
    ],
    actions: [
      { type: "commentCard", date: "2026-09-01T10:00:00.000Z",
        data: { card: { id: "c1" }, text: "looks good" }, memberCreator: { fullName: "Ann" } },
      { type: "updateCard", date: "2026-09-02T10:00:00.000Z", data: { card: { id: "c1" } } },
    ],
  };

  it("maps lists, cards, labels and checklists, keeping board order", () => {
    const b = readTrelloExport(JSON.stringify(trello));
    expect(b.title).toBe("Product");
    expect(b.lists.map((l) => l.title)).toEqual(["To Do", "Done"]);      // the closed list is dropped
    expect(b.lists[0].cards.map((c) => c.title)).toEqual(["Ship it"]);   // the archived card too
    const card = b.lists[0].cards[0];
    expect(card.description).toBe("with a body");
    expect(card.labels).toEqual(["bug"]);
    expect(card.checklists).toEqual([{ title: "Steps", items: [
      { title: "first", isDone: true }, { title: "second", isDone: false },
    ] }]);
    expect(card.comments).toEqual([{ author: "Ann", text: "looks good", at: "2026-09-01T10:00:00.000Z" }]);
    expect(card.dueDate).toBe("2026-10-01T00:00:00.000Z");
  });

  it("keeps an unnamed label as its colour rather than importing a blank", () => {
    const b = readTrelloExport(JSON.stringify(trello));
    expect(b.labels.map((l) => l.name)).toEqual(["bug", "sky"]);
  });

  it("refuses a file that is not a Trello board, with a sentence a person can act on", () => {
    expect(() => readTrelloExport("{}")).toThrow(/does not look like a Trello board/i);
    expect(() => readTrelloExport("not json at all")).toThrow(/could not be read as JSON/i);
  });
});

describe("Jira CSV", () => {
  const csv = [
    "Issue key,Issue Type,Summary,Description,Status,Priority,Story Points,Assignee,Due Date,Labels,Labels",
    'SYN-1,Story,"Sign-in fails","When the token expires",In Progress,High,5,Ann,2026-10-02,auth,urgent',
    "SYN-2,Bug,Crash on save,,Done,Highest,,,,,",
  ].join("\n");

  it("maps Jira's columns onto our card fields", () => {
    const b = readJiraCsv(csv);
    expect(b.lists.map((l) => l.title)).toEqual(["In Progress", "Done"]);   // a list per status, in first-seen order
    const one = b.lists[0].cards[0];
    expect(one).toMatchObject({
      title: "Sign-in fails", description: "When the token expires",
      issueType: "story", priority: "high", points: 5, dueDate: "2026-10-02",
    });
    expect(one.labels).toEqual(["auth", "urgent"]);        // Jira repeats the Labels column per label
    expect(b.lists[1].cards[0]).toMatchObject({ title: "Crash on save", issueType: "bug", priority: "highest" });
    expect(b.lists[1].cards[0].points).toBeNull();
  });

  it("needs a Summary column and says so", () => {
    expect(() => readJiraCsv("Issue key,Status\nSYN-1,Done")).toThrow(/Summary/i);
  });
});
