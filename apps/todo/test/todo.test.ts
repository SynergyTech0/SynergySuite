import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

const alice = "alice@example.com";
const bob = "bob@example.com";
const carol = "carol@example.com";
const today = "2026-10-16";

describe.skipIf(!url)("to do", async () => {
  const todo = await import("../lib/todo");
  const { q, db } = await import("../lib/db");

  beforeAll(async () => {
    await q("SELECT 1");
    await q("TRUNCATE lists CASCADE");
  });
  afterAll(async () => {
    await db().close();
  });

  it("gives everyone a Tasks list that can't be renamed, deleted or shared", async () => {
    const [tasks] = await todo.lists(alice);
    expect(tasks).toMatchObject({ name: "Tasks", isDefault: true, owner: alice });
    expect((await todo.lists(alice)).length).toBe(1);
    await expect(todo.updateList(alice, tasks.id, { name: "X" })).rejects.toThrow(/can't be renamed/);
    await expect(todo.deleteList(alice, tasks.id)).rejects.toThrow(/can't be deleted/);
    await expect(todo.share(alice, tasks.id, bob)).rejects.toThrow(/stays yours/);
  });

  it("adds tasks to My Day, Important and Planned", async () => {
    const a = await todo.createTask(alice, { title: "Buy milk", myDay: true, today });
    const b = await todo.createTask(alice, { title: "Call the bank", important: true, due: "2026-10-20", today });
    expect(a.listName).toBe("Tasks");
    expect(a.myDay).toBe(true);
    expect((await todo.tasks(alice, { view: "myday", today })).map((t) => t.id)).toEqual([a.id]);
    // My Day starts empty again the next day.
    expect(await todo.tasks(alice, { view: "myday", today: "2026-10-17" })).toEqual([]);
    expect((await todo.tasks(alice, { view: "important", today })).map((t) => t.id)).toEqual([b.id]);
    expect((await todo.tasks(alice, { view: "planned", today })).map((t) => t.id)).toEqual([b.id]);
    expect(await todo.counts(alice, today)).toEqual({ myday: 1, important: 1, planned: 1, assigned: 0, all: 2 });
    expect((await todo.tasks(alice, { view: "all", today, q: "bank" })).map((t) => t.id)).toEqual([b.id]);
    expect((await todo.suggestions(alice, "2026-10-17")).map((t) => t.title)).toEqual(["Buy milk"]);
  });

  it("refuses bad input", async () => {
    await expect(todo.createTask(alice, { title: " ", today })).rejects.toThrow(/title/);
    await expect(todo.createTask(alice, { title: "x", today: "yesterday" })).rejects.toThrow(/Bad date/);
    const t = await todo.createTask(alice, { title: "x", today });
    await expect(todo.updateTask(alice, t.id, { due: "2026-02-30", today })).rejects.toThrow(/due date/);
    await expect(todo.updateTask(alice, t.id, { repeat: "hourly", today })).rejects.toThrow(/repeats/);
    await todo.deleteTask(alice, t.id);
  });

  it("completes a repeating task and makes the next one with fresh steps", async () => {
    const t = await todo.createTask(alice, { title: "Water plants", today });
    await todo.updateTask(alice, t.id, { repeat: "weekly", reminderAt: "2026-10-16T09:00:00Z", today });
    await todo.addStep(alice, t.id, "Fern");
    await todo.addStep(alice, t.id, "Cactus");
    const withSteps = await todo.getTask(alice, t.id, today);
    expect(withSteps.due).toBe(today); // repeating needs a start date: today
    await todo.updateStep(alice, t.id, withSteps.steps[0].id, { done: true });

    const done = await todo.updateTask(alice, t.id, { completed: true, today });
    expect(done.completedAt).not.toBeNull();
    expect(done.repeat).toBeNull();
    expect(done.next).toMatchObject({ title: "Water plants", due: "2026-10-23", repeat: "weekly", completedAt: null, reminderAt: "2026-10-23T09:00:00.000Z" });
    expect(done.next!.steps.map((s) => [s.title, s.done])).toEqual([["Fern", false], ["Cactus", false]]);
    // Completing again (after un-completing) makes no second copy.
    await todo.updateTask(alice, t.id, { completed: false, today });
    const again = await todo.updateTask(alice, t.id, { completed: true, today });
    expect(again.next).toBeUndefined();
  });

  it("skips ahead when an old repeating task is finished late", async () => {
    const t = await todo.createTask(alice, { title: "Standup notes", due: "2026-10-01", today });
    await todo.updateTask(alice, t.id, { repeat: "daily", today });
    const done = await todo.updateTask(alice, t.id, { completed: true, today });
    expect(done.next?.due).toBe("2026-10-17");
  });

  it("shares a list, lets members work in it and assign tasks, and keeps other lists private", async () => {
    const list = await todo.createList(alice, "Groceries", "green");
    await expect(todo.tasks(bob, { list: list.id, today })).rejects.toThrow(/not found/);
    await expect(todo.createTask(bob, { listId: list.id, title: "Sneaky", today })).rejects.toThrow(/not found/);
    await expect(todo.share(bob, list.id, bob)).rejects.toThrow(/not found/);

    await todo.share(alice, list.id, bob);
    const bobs = await todo.createTask(bob, { listId: list.id, title: "Eggs", today });
    expect((await todo.lists(bob)).map((l) => l.name)).toEqual(["Tasks", "Groceries"]);
    await expect(todo.updateTask(bob, bobs.id, { assignedTo: carol, today })).rejects.toThrow(/Share the list/);
    await todo.updateTask(bob, bobs.id, { assignedTo: alice, today });
    expect((await todo.tasks(alice, { view: "assigned", today })).map((t) => t.title)).toEqual(["Eggs"]);
    await expect(todo.share(bob, list.id, carol)).rejects.toThrow(/owner/);
    await expect(todo.deleteList(bob, list.id)).rejects.toThrow(/owner/);

    // Bob's own Tasks list stays private, and his My Day stays his.
    const mine = await todo.createTask(bob, { title: "Private", today });
    await expect(todo.getTask(alice, mine.id, today)).rejects.toThrow(/not found/);
    await todo.updateTask(bob, bobs.id, { myDay: true, today });
    expect((await todo.getTask(alice, bobs.id, today)).myDay).toBe(false);
    // Moving a task into a list someone can't see is refused.
    await expect(todo.updateTask(alice, bobs.id, { listId: (await todo.lists(bob))[0].id, today })).rejects.toThrow(/not found/);

    // When Bob leaves, his My Day pick and assignment on that list go with him.
    await todo.updateTask(alice, bobs.id, { assignedTo: bob, today });
    await todo.unshare(bob, list.id, bob);
    await expect(todo.getTask(bob, bobs.id, today)).rejects.toThrow(/not found/);
    expect((await todo.getTask(alice, bobs.id, today)).assignedTo).toBeNull();
  });

  it("hands out each reminder once, only to the person who set it", async () => {
    const list = await todo.createList(alice, "Shared");
    await todo.share(alice, list.id, bob);
    const t = await todo.createTask(alice, { listId: list.id, title: "Renew passport", today });
    await todo.updateTask(alice, t.id, { reminderAt: new Date(Date.now() - 60000).toISOString(), today });
    expect((await todo.getTask(bob, t.id, today)).reminderAt).toBeNull();
    expect(await todo.dueReminders(bob)).toEqual([]);
    expect((await todo.dueReminders(alice)).map((r) => r.title)).toEqual(["Renew passport"]);
    expect(await todo.dueReminders(alice)).toEqual([]);
  });
});
