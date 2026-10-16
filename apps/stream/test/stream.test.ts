import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PolicyClient, SearchResponse } from "@synergy/compliance";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
// Uploads are processed with the real ffmpeg when it is installed.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.COMPLIANCE_TOKEN = "test-token";
const work = mkdtempSync(path.join(tmpdir(), "stream-test-"));
process.env.STREAM_DIR = path.join(work, "store");

let hasFfmpeg = false;
try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  hasFfmpeg = true;
} catch {
  hasFfmpeg = false;
}

const alice = { email: "alice@example.com", name: "Alice" };
const bob = { email: "bob@example.com", name: "Bob" };
const carol = { email: "carol@example.com", name: "Carol" };

const held = new Set<string>();
const fakePolicy: PolicyClient = {
  onHold: async (e) => held.has(e),
  retention: async () => [],
  retentionDays: async () => null,
  invalidate() {},
};

const SRT = "1\n00:00:00,500 --> 00:00:02,000\nWelcome to the launch review.\n\n2\n00:00:02,000 --> 00:00:03,500\nThe budget is approved.\n";

describe.skipIf(!url)("stream", async () => {
  const videos = await import("../lib/videos");
  const projects = await import("../lib/projects");
  const { searchFor } = await import("../lib/search");
  const { q, db } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");
  const searchRoute = await import("../app/api/compliance/search/route");
  const exportRoute = await import("../app/api/compliance/export/route");

  const call = (route: { POST: (req: Request) => Promise<Response> }, body: unknown, token: string | null = "test-token") =>
    route.POST(
      new Request("http://stream/api/compliance", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      }),
    );
  const csearch = async (body: Record<string, unknown>) => {
    const res = await call(searchRoute, body);
    expect(res.status).toBe(200);
    return (await res.json()) as SearchResponse;
  };
  const bytes = (b: Buffer) => Readable.toWeb(Readable.from([b])) as unknown as ReadableStream<Uint8Array>;
  const waitReady = async (id: string) => {
    for (let i = 0; i < 100; i++) {
      const [r] = await q<{ status: string }>("SELECT status FROM videos WHERE id = $1", [id]);
      if (r.status !== "processing") return r.status;
      await new Promise((res) => setTimeout(res, 200));
    }
    return "processing";
  };

  let launch: { id: string };
  let party: { id: string };

  beforeAll(async () => {
    setPolicy(fakePolicy);
    await q("SELECT 1");
    await q("TRUNCATE videos, projects CASCADE");
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
  });

  it("takes video files and makes them watchable", async () => {
    await expect(videos.createVideo(alice, "notes.txt", bytes(Buffer.from("hi")))).rejects.toThrow(/isn't a video file/);
    let clip = Buffer.from("not really a video");
    if (hasFfmpeg) {
      const file = path.join(work, "clip.mp4");
      execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15", "-f", "lavfi", "-i", "sine", "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", file]);
      clip = readFileSync(file);
    }
    const v = await videos.createVideo(alice, "Launch review.mp4", bytes(clip));
    expect(v).toMatchObject({ title: "Launch review", owner: alice.email, status: "processing", visibility: "private" });
    launch = v;
    const status = await waitReady(v.id);
    if (hasFfmpeg) {
      expect(status).toBe("ready");
      const d = await videos.getVideo(alice, v.id);
      expect(d).toMatchObject({ width: 320, height: 240, can_edit: true });
      expect(typeof d.size).toBe("number");
      expect(d.duration).toBeCloseTo(4, 0);
    } else {
      expect(status).toBe("failed");
    }
    party = await videos.createVideo(bob, "Team party.webm", bytes(Buffer.from("x".repeat(100))), "recording");
    await waitReady(party.id);
  });

  it("shows a video only to the people who may watch it", async () => {
    await expect(videos.getVideo(bob, launch.id)).rejects.toThrow(/Not found/);
    expect(await videos.listVideos(bob, "shared")).toEqual([]);
    await videos.addMember(alice, launch.id, bob.email);
    expect((await videos.listVideos(bob, "shared")).map((v) => v.title)).toEqual(["Launch review"]);
    const forBob = await videos.getVideo(bob, launch.id);
    expect(forBob).toMatchObject({ can_edit: false, members: [], share_token: null });
    await expect(videos.updateVideo(bob, launch.id, { title: "Mine now" })).rejects.toThrow(/Not found/);
    await expect(videos.deleteVideo(bob, launch.id)).rejects.toThrow(/Not found/);
    // Everyone in the organization.
    await expect(videos.getVideo(carol, launch.id)).rejects.toThrow(/Not found/);
    await videos.updateVideo(alice, launch.id, { visibility: "org" });
    expect((await videos.getVideo(carol, launch.id)).title).toBe("Launch review");
    expect((await videos.listVideos(carol, "org")).map((v) => v.id)).toEqual(hasFfmpeg ? [launch.id] : []);
    await videos.updateVideo(alice, launch.id, { visibility: "private" });
    await expect(videos.getVideo(carol, launch.id)).rejects.toThrow(/Not found/);
  });

  it("shares by link, and a new link retires the old one", async () => {
    const { share_token: first } = await videos.setLink(alice, launch.id, true);
    expect((await videos.sharedByToken(first!)).title).toBe("Launch review");
    const { share_token: second } = await videos.setLink(alice, launch.id, true);
    await expect(videos.sharedByToken(first!)).rejects.toThrow(/doesn't work/);
    await videos.setLink(alice, launch.id, false);
    await expect(videos.sharedByToken(second!)).rejects.toThrow(/doesn't work/);
  });

  it("keeps captions as the transcript, and chapters in order", async () => {
    await expect(videos.setCaptions(bob, launch.id, SRT)).rejects.toThrow(/Not found/);
    await expect(videos.setCaptions(alice, launch.id, "nothing")).rejects.toThrow(/no captions/);
    const v = await videos.setCaptions(alice, launch.id, SRT);
    expect(v).toMatchObject({ has_captions: true, captions_source: "upload", captions_status: "ready" });
    const updated = await videos.updateVideo(alice, launch.id, {
      description: "Quarterly launch check-in",
      chapters: [{ t: 2, title: "Budget" }, { t: 0, title: "Welcome" }],
    });
    expect(updated.chapters).toEqual(hasFfmpeg ? [{ t: 0, title: "Welcome" }, { t: 2, title: "Budget" }] : [{ t: 0, title: "Welcome" }, { t: 2, title: "Budget" }]);
  });

  it("finds videos by transcript for the people who can watch them", async () => {
    const forAlice = await searchFor(alice, { query: "budget approved" });
    expect(forAlice.results.map((r) => r.title)).toEqual(hasFfmpeg ? ["Launch review"] : []);
    if (hasFfmpeg) expect(forAlice.results[0]).toMatchObject({ kind: "video", url: `/watch/${launch.id}` });
    expect((await searchFor(carol, { query: "budget" })).results).toEqual([]);
    expect((await searchFor(bob, { query: "budget", kinds: ["file"] })).results).toEqual([]);
  });

  it("takes comments at a moment, and lets authors and owners remove them", async () => {
    const c = await videos.addComment(bob, launch.id, "Can we see the numbers?", 1.5);
    expect(c).toMatchObject({ author: bob.email, at_seconds: hasFfmpeg ? 1.5 : 1.5, mine: true });
    await expect(videos.addComment(carol, launch.id, "Hi", null)).rejects.toThrow(/Not found/);
    await expect(videos.addComment(bob, launch.id, "  ", null)).rejects.toThrow(/Write a comment/);
    const mine = await videos.addComment(alice, launch.id, "Slides attached", null);
    await expect(videos.deleteComment(bob, launch.id, mine.id)).rejects.toThrow(/Not found/);
    await videos.updateVideo(alice, launch.id, { allow_comments: false });
    await expect(videos.addComment(bob, launch.id, "More?", null)).rejects.toThrow(/turned off/);
    await videos.updateVideo(alice, launch.id, { allow_comments: true });
    expect((await videos.listComments(alice, launch.id)).map((x) => x.body)).toEqual(["Can we see the numbers?", "Slides attached"]);
  });

  it("answers the Admin center's eDiscovery searches and exports", async () => {
    expect((await call(searchRoute, {}, null)).status).toBe(401);
    const all = await csearch({});
    expect(all.hits.map((h) => `${h.kind}:${h.title}`).sort()).toEqual([
      "comment:Comment on Launch review",
      "comment:Comment on Launch review",
      "video:Launch review",
      "video:Team party",
    ]);
    expect((await csearch({ query: "budget" })).hits.map((h) => h.title)).toEqual(["Launch review"]);
    const forBob = await csearch({ custodians: [bob.email] });
    // His own recording and comment, and the video shared with him.
    expect(forBob.hits.map((h) => `${h.kind}:${h.owner}`).sort()).toEqual([`comment:${bob.email}`, `video:${alice.email}`, `video:${bob.email}`]);
    expect((await csearch({ kinds: ["comment"], custodians: [alice.email] })).hits.map((h) => h.owner).sort()).toEqual([alice.email, bob.email]);
    const id = `video:${launch.id}`;
    const { items } = await (await call(exportRoute, { ids: [id] })).json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ app: "stream", kind: "video", owner: alice.email, participants: [bob.email] });
    expect(items[0].text).toContain("The budget is approved.");
    expect(items[0].metadata.comments.map((c: { body: string }) => c.body)).toEqual(["Can we see the numbers?", "Slides attached"]);
    expect(items[0].attachments[0]).toMatchObject({ name: "captions.vtt", type: "text/vtt" });
  });

  it("keeps what is deleted under a hold, hidden but found", async () => {
    held.add(alice.email);
    await videos.deleteVideo(alice, launch.id);
    await expect(videos.getVideo(alice, launch.id)).rejects.toThrow(/Not found/);
    expect((await videos.listVideos(alice, "mine")).map((v) => v.id)).not.toContain(launch.id);
    expect((await csearch({ kinds: ["video"], query: "launch" })).hits).toEqual([expect.objectContaining({ id: `video:${launch.id}`, deleted: true })]);
    held.delete(alice.email);
    // Without a hold it is gone for good.
    await videos.deleteVideo(bob, party.id);
    expect((await csearch({ kinds: ["video"], query: "party" })).hits).toEqual([]);
  });

  it("keeps editor projects with the videos they use", async () => {
    const mine = await videos.createVideo(carol, "Raw footage.mov", bytes(Buffer.from("x".repeat(10))));
    const p = await projects.createProject(carol, "Promo", new Uint8Array([1, 2, 3]), [mine.id, launch.id, "junk"]);
    // The held, deleted video and the junk id are not remembered.
    expect(p).toMatchObject({ name: "Promo.fcproj", size: 3, video_ids: [mine.id] });
    await expect(projects.getProject(alice, p.id)).rejects.toThrow(/Not found/);
    const again = await projects.replaceProject(carol, p.id, new Uint8Array([4, 5, 6, 7]), []);
    expect(again).toMatchObject({ size: 4, video_ids: [] });
    expect((await projects.listProjects(carol)).map((x) => x.name)).toEqual(["Promo.fcproj"]);
    await projects.deleteProject(carol, p.id);
    expect(await projects.listProjects(carol)).toEqual([]);
  });
});
