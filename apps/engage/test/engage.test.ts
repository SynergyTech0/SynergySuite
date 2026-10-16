import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@synergy/db";

// Runs against a real Postgres when TEST_DATABASE_URL is set, in a database of its own
// ("<name>_engage"), so it can run alongside the other test files.
const base = process.env.TEST_DATABASE_URL;
process.env.ENGAGE_ADMIN_EMAILS = "admin@example.com";

async function ownDatabase(url: string): Promise<string> {
  const u = new URL(url);
  const name = `${u.pathname.slice(1)}_engage`;
  const admin = createDb({ connectionString: url, max: 1 });
  if (!(await admin.q("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.q(`CREATE DATABASE "${name}"`);
  await admin.close();
  u.pathname = `/${name}`;
  return u.toString();
}

const alice = { email: "alice@example.com", name: "Alice Adams" };
const bob = { email: "bob@example.com", name: "Bob Brown" };
const carol = { email: "carol@example.com", name: "Carol Chen" };
const admin = { email: "admin@example.com", name: "Ada Admin" };

describe.skipIf(!base)("engage", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base);
  const e = await import("../lib/engage");
  const { q, db } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");

  beforeAll(async () => {
    setPolicy({ onHold: async () => false, retention: async () => [], retentionDays: async () => null, invalidate() {} });
    await q("TRUNCATE people, communities, posts, follows, reactions, quick_links CASCADE");
    e.resetSeen();
    for (const p of [alice, bob, carol, admin]) await e.touch(p);
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
  });

  it("puts everyone in All Company on their first visit", async () => {
    const [all] = await e.communities(alice.email, { mine: true });
    expect(all).toMatchObject({ slug: "all-company", official: true, members: 4, myRole: "member", canManage: false });
    await expect(e.leave(alice, all.id)).rejects.toThrow(/All Company/);
    expect((await e.getCommunity(admin.email, "all-company")).canManage).toBe(true);
  });

  it("reads mentions and topics out of a post", () => {
    expect(e.mentionsIn("Thanks @Bob@Example.com and @carol@example.com, see bob@example.com.")).toEqual(["bob@example.com", "carol@example.com"]);
    expect(e.topicsIn("Launch day! #Launch #q4-plan and a#b url/#x #a")).toEqual(["launch", "q4-plan"]);
  });

  it("keeps private communities to their members", async () => {
    const design = await e.createCommunity(alice, { name: "Design Team", description: "Pixels", privacy: "private" });
    expect(design).toMatchObject({ slug: "design-team", privacy: "private", myRole: "admin", members: 1 });
    await expect(e.getCommunity(bob.email, design.id)).rejects.toThrow(/not found/);
    await expect(e.join(bob, design.id)).rejects.toThrow(/not found/);
    await e.addMember(alice, design.id, bob.email);
    expect((await e.getCommunity(bob.email, "design-team")).myRole).toBe("member");
    await expect(e.addMember(bob, design.id, carol.email)).rejects.toThrow(/admins/);
    // The last admin can't walk out on members.
    await expect(e.leave(alice, design.id)).rejects.toThrow(/someone else an admin/);
    const again = await e.createCommunity(carol, { name: "Design team" });
    expect(again.slug).toBe("design-team-2");
  });

  it("posts, replies, reacts and builds each feed", async () => {
    const design = await e.getCommunity(alice.email, "design-team");
    await expect(e.createPost(carol, { communityId: design.id, body: "hi" })).rejects.toThrow(/not found/);
    const open = await e.createCommunity(bob, { name: "Running club" });
    await expect(e.createPost(carol, { communityId: open.id, body: "hi" })).rejects.toThrow(/Join/);
    await e.join(carol, open.id);
    const run = await e.createPost(carol, { communityId: open.id, body: "Who's in for the 5k? #running @alice@example.com" });
    expect(run).toMatchObject({ topics: ["running"], mentions: [{ email: alice.email, name: "Alice Adams" }], community: { slug: "running-club" } });

    const secret = await e.createPost(alice, { communityId: design.id, title: "New logo", body: "Draft attached" });
    const story = await e.createPost(bob, { body: "Back from leave, hello all" });
    expect(story.community).toBeNull();

    const reply = await e.addComment(bob, run.id, { body: "Count me in" });
    const nested = await e.addComment(alice, run.id, { body: "Me too", parentId: reply.id });
    const deeper = await e.addComment(carol, run.id, { body: "Great", parentId: nested.id });
    expect(deeper.parentId).toBe(reply.id);
    await e.react(alice, run.id, "celebrate");
    await e.react(bob, run.id, "like");
    await e.react(bob, run.id, "celebrate");
    await e.react(carol, reply.id, "love");
    await expect(e.react(carol, secret.id, "like")).rejects.toThrow(/not found/);
    await expect(e.react(alice, run.id, "boo")).rejects.toThrow(/Unknown reaction/);

    const full = await e.getPost(alice.email, run.id);
    expect(full.reactions).toEqual({ celebrate: 2 });
    expect(full.myReaction).toBe("celebrate");
    expect(full.commentCount).toBe(3);
    expect(full.comments.map((c) => c.body)).toEqual(["Count me in", "Me too", "Great"]);
    expect(full.comments[0].reactions).toEqual({ love: 1 });

    const titles = async (who: string, f: Parameters<typeof e.feed>[1]) => (await e.feed(who, f)).posts.map((p) => p.title || p.body.slice(0, 12));
    // Carol: her community, her own post. Not Bob's storyline (she doesn't follow him), not Design.
    expect(await titles(carol.email, { view: "home" })).toEqual(["Who's in for"]);
    // Replies move a post up.
    expect(await titles(carol.email, { view: "discover" })).toEqual(["Who's in for", "Back from le"]);
    await e.follow(carol, bob.email, true);
    expect(await titles(carol.email, { view: "home" })).toEqual(["Who's in for", "Back from le"]);
    // Alice is mentioned in the run post without being in the club.
    expect(await titles(alice.email, { view: "mentions" })).toEqual(["Who's in for"]);
    expect(await titles(alice.email, { view: "topic", topic: "#Running" })).toEqual(["Who's in for"]);
    expect(await titles(bob.email, { view: "community", community: "design-team" })).toEqual(["New logo"]);
    expect(await titles(carol.email, { view: "person", person: alice.email })).toEqual([]);
    expect((await e.feed(carol.email, { view: "home" })).posts[0].comments.map((c) => c.body)).toEqual(["Me too", "Great"]);

    const page = await e.feed(carol.email, { view: "discover", limit: 1 });
    expect(page.next).toBeTruthy();
    const rest = await e.feed(carol.email, { view: "discover", limit: 1, cursor: page.next });
    expect(rest.posts.map((p) => p.id)).toEqual([story.id]);
    expect(rest.next).toBeNull();

    expect((await e.person(carol.email, bob.email))).toMatchObject({ name: "Bob Brown", followers: 1, followed: true, posts: 1 });
  });

  it("runs polls, praise, questions and articles", async () => {
    const all = await e.getCommunity(alice.email, "all-company");
    await expect(e.createPost(alice, { communityId: all.id, kind: "poll", body: "Lunch?", options: ["Pizza"] })).rejects.toThrow(/two choices/);
    const poll = await e.createPost(alice, { communityId: all.id, kind: "poll", body: "Lunch?", options: ["Pizza", "Tacos", "Pizza"] });
    expect(poll.poll?.options.map((o) => o.label)).toEqual(["Pizza", "Tacos"]);
    await e.vote(bob, poll.id, poll.poll!.options[1].id);
    await e.vote(carol, poll.id, poll.poll!.options[1].id);
    const voted = await e.vote(bob, poll.id, poll.poll!.options[0].id);
    expect(voted.poll).toMatchObject({ total: 2, myVote: poll.poll!.options[0].id });
    expect(voted.poll!.options.map((o) => o.votes)).toEqual([1, 1]);

    await expect(e.createPost(alice, { kind: "praise", praised: [alice.email] })).rejects.toThrow(/who you're praising/);
    const praise = await e.createPost(alice, { kind: "praise", praised: [bob.email, "nope"], badge: "team-player", body: "Saved the launch" });
    expect(praise).toMatchObject({ praised: [{ email: bob.email }], badge: "team-player" });
    expect((await e.feed(bob.email, { view: "mentions" })).posts.map((p) => p.id)).toContain(praise.id);

    const question = await e.createPost(bob, { communityId: all.id, kind: "question", body: "Where is the VPN guide?" });
    expect((await e.feed(carol.email, { view: "questions" })).posts.map((p) => p.id)).toEqual([question.id]);
    const answer = await e.addComment(carol, question.id, { body: "In Drive under IT" });
    await expect(e.markAnswer(carol, question.id, answer.id)).rejects.toThrow(/asked/);
    expect((await e.markAnswer(bob, question.id, answer.id)).bestAnswer).toBe(answer.id);
    expect((await e.feed(carol.email, { view: "questions" })).posts).toEqual([]);

    await expect(e.createPost(alice, { kind: "article", body: "no title" })).rejects.toThrow(/title/);
    await expect(e.createPost(alice, { communityId: all.id, announcement: true, body: "Hi" })).rejects.toThrow(/admins/);
    const news = await e.createPost(admin, { communityId: all.id, announcement: true, kind: "article", title: "Office reopens", body: "Monday" });
    const h = await e.home(carol);
    expect(h.news[0].id).toBe(news.id);
    expect(h.me.admin).toBe(false);
    expect(h.communities[0].slug).toBe("all-company");
    expect(h.suggested).toEqual([]);
    expect((await e.home(bob)).suggested.map((c) => c.slug)).toEqual(["design-team-2"]);
    expect(h.topics).toEqual([{ topic: "running", posts: 1 }]);
  });

  it("lets authors edit and moderators pin, announce and delete", async () => {
    const club = await e.getCommunity(bob.email, "running-club");
    const p = await e.createPost(carol, { communityId: club.id, body: "Rain plan?" });
    await expect(e.updatePost(bob, p.id, { body: "x" })).rejects.toThrow(/author/);
    expect((await e.updatePost(carol, p.id, { body: "Rain plan? #weather" })).topics).toEqual(["weather"]);
    await expect(e.updatePost(carol, p.id, { pinned: true })).rejects.toThrow(/admins/);
    expect((await e.updatePost(bob, p.id, { pinned: true })).pinned).toBe(true);
    const first = await e.feed(carol.email, { view: "community", community: club.id });
    expect(first.posts[0].id).toBe(p.id);
    const c = await e.addComment(alice, p.id, { body: "Indoors" });
    await expect(e.deleteComment(carol, c.id)).rejects.toThrow(/admins/);
    await e.deleteComment(bob, c.id);
    await expect(e.deletePost(alice, p.id)).rejects.toThrow(/admins/);
    await e.deletePost(admin, p.id);
    await expect(e.getPost(carol.email, p.id)).rejects.toThrow(/not found/);
    expect(await q("SELECT 1 FROM posts WHERE id = $1", [p.id])).toEqual([]);
  });

  it("lets company admins run the home page's links", async () => {
    await expect(e.addQuickLink(alice, { label: "HR", url: "https://hr.example.com" })).rejects.toThrow(/company admin/);
    await expect(e.addQuickLink(admin, { label: "Bad", url: "javascript:alert(1)" })).rejects.toThrow(/http/);
    const l = await e.addQuickLink(admin, { label: "HR", url: "https://hr.example.com" });
    await e.addQuickLink(admin, { label: "IT", url: "https://it.example.com" });
    await e.updateQuickLink(admin, l.id, { position: 5 });
    expect((await e.quickLinks()).map((x) => x.label)).toEqual(["IT", "HR"]);
    await e.deleteQuickLink(admin, l.id);
    expect((await e.quickLinks()).map((x) => x.label)).toEqual(["IT"]);
  });
});
