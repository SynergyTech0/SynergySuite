import { displayNameFromEmail } from "@synergy/identity";
import { companyName, isCompanyAdmin } from "./access";
import { holdChecker } from "./compliance";
import { q, tx } from "./db";
import {
  ALL_COMPANY, BADGES, COLORS, KINDS, REACTIONS,
  type Comment, type Community, type CommunityRef, type FeedPage, type FeedView, type Home, type Person, type PersonRef,
  type Post, type PostKind, type Privacy, type QuickLink, type Reaction, type Role,
} from "./types";
import { UserError, cleanEmail, isEmail, text } from "./util";

import type { Me } from "./api";

export type { Me };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(v: unknown, what = "Post"): string {
  const s = String(v ?? "");
  if (!UUID.test(s)) throw new UserError(`${what} not found`, 404);
  return s;
}

// Access

/** Communities someone can see: public ones and private ones they belong to. Uses $1 = viewer. */
export const VISIBLE_COMMUNITIES = `(SELECT c.id FROM communities c WHERE c.held_deleted_at IS NULL
  AND (c.privacy = 'public' OR EXISTS (SELECT 1 FROM members m WHERE m.community_id = c.id AND m.email = $1)))`;

/** Whether post `p` is visible to $1: on a storyline, or in a community they can see. */
export const VISIBLE_POST = `(p.held_deleted_at IS NULL AND (p.community_id IS NULL OR p.community_id IN ${VISIBLE_COMMUNITIES}))`;

// People

const seen = new Map<string, number>();

/**
 * Records that someone used Engage: their name for others to see and a seat in All Company.
 * At most once every five minutes per person and process.
 */
export async function touch(me: Me): Promise<void> {
  const last = seen.get(me.email) ?? 0;
  if (Date.now() - last < 300_000) return;
  const [row] = await q<{ fresh: boolean }>(
    `INSERT INTO people (email, name) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, last_seen = now()
     RETURNING (xmax = 0) AS fresh`,
    [me.email, me.name || displayNameFromEmail(me.email)],
  );
  if (row?.fresh) {
    const all = await allCompany();
    await q(`INSERT INTO members (community_id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [all, me.email]);
  }
  seen.set(me.email, Date.now());
}

/** Forgets who was recently seen, for tests. */
export function resetSeen(): void {
  seen.clear();
}

/** The All Company community's id, made on first use. */
export async function allCompany(): Promise<string> {
  const [row] = await q<{ id: string }>(
    `INSERT INTO communities (slug, name, description, official, created_by)
     VALUES ($1, 'All Company', 'Everyone in the company. Company-wide announcements are posted here.', true, 'system')
     ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id`,
    [ALL_COMPANY],
  );
  return row.id;
}

async function names(emails: Iterable<string>): Promise<Map<string, string>> {
  const list = [...new Set(emails)].filter(Boolean);
  const out = new Map<string, string>();
  if (!list.length) return out;
  const rows = await q<{ email: string; name: string }>(`SELECT email, name FROM people WHERE email = ANY($1)`, [list]);
  for (const r of rows) out.set(r.email, r.name);
  for (const e of list) if (!out.has(e)) out.set(e, displayNameFromEmail(e));
  return out;
}

const ref = (n: Map<string, string>, email: string): PersonRef => ({ email, name: n.get(email) ?? displayNameFromEmail(email) });

/** Everyone who has used Engage, matching `query` by name, email, title or department. */
export async function people(query = "", limit = 20): Promise<(PersonRef & { title: string; department: string })[]> {
  const like = `%${query.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return q(
    `SELECT email, name, title, department FROM people
     WHERE $1 = '%%' OR name ILIKE $1 OR email ILIKE $1 OR title ILIKE $1 OR department ILIKE $1
     ORDER BY lower(name), email LIMIT $2`,
    [like, Math.min(Math.max(limit, 1), 50)],
  );
}

export async function person(viewer: string, emailIn: string): Promise<Person> {
  const email = cleanEmail(emailIn);
  const [p] = await q<{ name: string | null; title: string | null; department: string | null; about: string | null; followers: string; following: string; followed: boolean; communities: string; posts: string }>(
    `SELECT pe.name, pe.title, pe.department, pe.about,
       (SELECT count(*) FROM follows WHERE followee = $2) AS followers,
       (SELECT count(*) FROM follows WHERE follower = $2) AS following,
       EXISTS (SELECT 1 FROM follows WHERE follower = $1 AND followee = $2) AS followed,
       (SELECT count(*) FROM members m WHERE m.email = $2 AND m.community_id IN ${VISIBLE_COMMUNITIES}) AS communities,
       (SELECT count(*) FROM posts p WHERE p.author = $2 AND ${VISIBLE_POST}) AS posts
     FROM (SELECT 1) one LEFT JOIN people pe ON pe.email = $2`,
    [viewer, email],
  );
  return {
    email,
    name: p.name ?? displayNameFromEmail(email),
    title: p.title ?? "",
    department: p.department ?? "",
    about: p.about ?? "",
    followers: Number(p.followers),
    following: Number(p.following),
    followed: p.followed,
    communities: Number(p.communities),
    posts: Number(p.posts),
  };
}

export async function updateProfile(me: Me, v: { title?: unknown; department?: unknown; about?: unknown }): Promise<void> {
  await touch(me);
  await q(
    `UPDATE people SET title = COALESCE($2, title), department = COALESCE($3, department), about = COALESCE($4, about) WHERE email = $1`,
    [me.email, v.title === undefined ? null : text(v.title, 120), v.department === undefined ? null : text(v.department, 120), v.about === undefined ? null : text(v.about, 1000)],
  );
}

export async function follow(me: Me, who: unknown, on: boolean): Promise<void> {
  const email = cleanEmail(who);
  if (email === me.email) throw new UserError("You can't follow yourself");
  if (on) await q(`INSERT INTO follows (follower, followee) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [me.email, email]);
  else await q(`DELETE FROM follows WHERE follower = $1 AND followee = $2`, [me.email, email]);
}

// Communities

type CommunityRow = {
  id: string; slug: string; name: string; description: string; privacy: Privacy; color: string; official: boolean;
  chat_url: string; chat_name: string; site_url: string; created_by: string; created_at: Date;
  members: string; posts: string; last_activity: Date | null; my_role: Role | null;
};

const COMMUNITY_SELECT = `SELECT c.id, c.slug, c.name, c.description, c.privacy, c.color, c.official, c.chat_url, c.chat_name, c.site_url,
  c.created_by, c.created_at,
  (SELECT count(*) FROM members m WHERE m.community_id = c.id) AS members,
  (SELECT count(*) FROM posts p WHERE p.community_id = c.id AND p.held_deleted_at IS NULL) AS posts,
  (SELECT max(p.activity_at) FROM posts p WHERE p.community_id = c.id AND p.held_deleted_at IS NULL) AS last_activity,
  (SELECT m.role FROM members m WHERE m.community_id = c.id AND m.email = $1) AS my_role
  FROM communities c`;

function community(r: CommunityRow, viewer: string): Community {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    privacy: r.privacy,
    color: r.color,
    official: r.official,
    chatUrl: r.chat_url,
    chatName: r.chat_name,
    siteUrl: r.site_url,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
    members: Number(r.members),
    posts: Number(r.posts),
    lastActivity: r.last_activity?.toISOString() ?? null,
    myRole: r.my_role,
    canManage: r.my_role === "admin" || isCompanyAdmin(viewer),
  };
}

/** Communities the viewer can see; `mine` for only the ones they belong to. */
export async function communities(viewer: string, opts: { mine?: boolean; query?: string } = {}): Promise<Community[]> {
  const params: unknown[] = [viewer];
  let where = `c.id IN ${VISIBLE_COMMUNITIES}`;
  if (opts.mine) where += ` AND EXISTS (SELECT 1 FROM members m WHERE m.community_id = c.id AND m.email = $1)`;
  if (opts.query?.trim()) {
    params.push(`%${opts.query.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where += ` AND (c.name ILIKE $2 OR c.description ILIKE $2)`;
  }
  const rows = await q<CommunityRow>(
    `${COMMUNITY_SELECT} WHERE ${where} ORDER BY c.official DESC, lower(c.name)`,
    params,
  );
  return rows.map((r) => community(r, viewer));
}

/** One community by id or slug, if the viewer can see it. */
export async function getCommunity(viewer: string, idOrSlug: string): Promise<Community> {
  const byId = UUID.test(idOrSlug);
  const rows = await q<CommunityRow>(
    `${COMMUNITY_SELECT} WHERE ${byId ? "c.id = $2::uuid" : "c.slug = $2"} AND c.id IN ${VISIBLE_COMMUNITIES}`,
    [viewer, idOrSlug],
  );
  if (!rows.length) throw new UserError("Community not found", 404);
  return community(rows[0], viewer);
}

async function managed(viewer: string, id: string): Promise<Community> {
  const c = await getCommunity(viewer, uuid(id, "Community"));
  if (!c.canManage) throw new UserError("Only the community's admins can do that", 403);
  return c;
}

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);

function color(v: unknown): string {
  const c = String(v ?? "blue");
  return (COLORS as readonly string[]).includes(c) ? c : "blue";
}

/** A link a community points at: an http(s) URL or nothing. */
function link(v: unknown): string {
  const s = text(v, 500);
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
  } catch {
    /* fall through */
  }
  throw new UserError("Links must start with http:// or https://");
}

export async function createCommunity(me: Me, v: { name?: unknown; description?: unknown; privacy?: unknown; color?: unknown }): Promise<Community> {
  await touch(me);
  const name = text(v.name, 80);
  if (!name) throw new UserError("Give the community a name");
  const base = slugify(name) || "community";
  const privacy: Privacy = v.privacy === "private" ? "private" : "public";
  const id = await tx(async (tq) => {
    let slug = base;
    for (let i = 2; (await tq(`SELECT 1 FROM communities WHERE slug = $1`, [slug])).length; i++) slug = `${base}-${i}`;
    const [row] = await tq<{ id: string }>(
      `INSERT INTO communities (slug, name, description, privacy, color, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [slug, name, text(v.description, 500), privacy, color(v.color), me.email],
    );
    await tq(`INSERT INTO members (community_id, email, role) VALUES ($1, $2, 'admin')`, [row.id, me.email]);
    return row.id;
  });
  return getCommunity(me.email, id);
}

export async function updateCommunity(
  me: Me, id: string,
  v: { name?: unknown; description?: unknown; privacy?: unknown; color?: unknown; chatUrl?: unknown; chatName?: unknown; siteUrl?: unknown; official?: unknown },
): Promise<Community> {
  const c = await managed(me.email, id);
  if (c.slug === ALL_COMPANY && v.privacy === "private") throw new UserError("All Company is open to everyone");
  if (v.official !== undefined && !isCompanyAdmin(me.email)) throw new UserError("Only a company admin can mark a community official", 403);
  const name = v.name === undefined ? null : text(v.name, 80);
  if (name === "") throw new UserError("Give the community a name");
  await q(
    `UPDATE communities SET name = COALESCE($2, name), description = COALESCE($3, description), privacy = COALESCE($4, privacy),
       color = COALESCE($5, color), chat_url = COALESCE($6, chat_url), chat_name = COALESCE($7, chat_name),
       site_url = COALESCE($8, site_url), official = COALESCE($9, official)
     WHERE id = $1`,
    [
      c.id, name,
      v.description === undefined ? null : text(v.description, 500),
      v.privacy === undefined ? null : v.privacy === "private" ? "private" : "public",
      v.color === undefined ? null : color(v.color),
      v.chatUrl === undefined ? null : link(v.chatUrl),
      v.chatName === undefined ? null : text(v.chatName, 80),
      v.siteUrl === undefined ? null : link(v.siteUrl),
      v.official === undefined ? null : v.official === true,
    ],
  );
  return getCommunity(me.email, c.id);
}

/**
 * Deletes a community and everything in it, unless someone who wrote there is on legal hold: then
 * it is hidden from everyone and kept for eDiscovery.
 */
export async function deleteCommunity(me: Me, id: string): Promise<void> {
  const c = await managed(me.email, id);
  if (c.slug === ALL_COMPANY) throw new UserError("All Company can't be deleted");
  const authors = await q<{ author: string }>(
    `SELECT DISTINCT author FROM posts WHERE community_id = $1
     UNION SELECT DISTINCT cm.author FROM comments cm JOIN posts p ON p.id = cm.post_id WHERE p.community_id = $1`,
    [c.id],
  );
  const held = holdChecker();
  for (const a of authors) {
    if (await held(a.author)) {
      await q(`UPDATE communities SET held_deleted_at = now() WHERE id = $1`, [c.id]);
      return;
    }
  }
  await tx(async (tq) => {
    await tq(
      `DELETE FROM reactions WHERE target_id IN (SELECT id FROM posts WHERE community_id = $1
         UNION SELECT cm.id FROM comments cm JOIN posts p ON p.id = cm.post_id WHERE p.community_id = $1)`,
      [c.id],
    );
    await tq(`DELETE FROM communities WHERE id = $1`, [c.id]);
  });
}

export async function join(me: Me, id: string): Promise<Community> {
  await touch(me);
  const c = await getCommunity(me.email, uuid(id, "Community"));
  if (c.privacy === "private" && !c.myRole) throw new UserError("Ask one of its admins to add you", 403);
  await q(`INSERT INTO members (community_id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [c.id, me.email]);
  return getCommunity(me.email, c.id);
}

export async function leave(me: Me, id: string): Promise<void> {
  const c = await getCommunity(me.email, uuid(id, "Community"));
  if (c.slug === ALL_COMPANY) throw new UserError("Everyone stays in All Company");
  await removeMember(me, c.id, me.email);
}

export type Member = PersonRef & { role: Role; joinedAt: string };

export async function members(viewer: string, id: string): Promise<Member[]> {
  const c = await getCommunity(viewer, uuid(id, "Community"));
  const rows = await q<{ email: string; name: string | null; role: Role; joined_at: Date }>(
    `SELECT m.email, pe.name, m.role, m.joined_at FROM members m LEFT JOIN people pe ON pe.email = m.email
     WHERE m.community_id = $1 ORDER BY m.role = 'admin' DESC, lower(COALESCE(pe.name, m.email)) LIMIT 500`,
    [c.id],
  );
  return rows.map((r) => ({ email: r.email, name: r.name ?? displayNameFromEmail(r.email), role: r.role, joinedAt: r.joined_at.toISOString() }));
}

/** An admin adds someone (the way into a private community), or changes their role. */
export async function addMember(me: Me, id: string, who: unknown, role: unknown = "member"): Promise<void> {
  const c = await managed(me.email, id);
  const email = cleanEmail(who);
  const r: Role = role === "admin" ? "admin" : "member";
  await q(
    `INSERT INTO members (community_id, email, role) VALUES ($1, $2, $3) ON CONFLICT (community_id, email) DO UPDATE SET role = EXCLUDED.role`,
    [c.id, email, r],
  );
}

/** Someone leaves, or an admin removes them. A community keeps at least one admin while it has members. */
export async function removeMember(me: Me, id: string, who: unknown): Promise<void> {
  const email = cleanEmail(who);
  const c = email === me.email ? await getCommunity(me.email, uuid(id, "Community")) : await managed(me.email, id);
  if (c.slug === ALL_COMPANY) throw new UserError("Everyone stays in All Company");
  await tx(async (tq) => {
    const [row] = await tq<{ role: Role }>(`SELECT role FROM members WHERE community_id = $1 AND email = $2 FOR UPDATE`, [c.id, email]);
    if (!row) return;
    if (row.role === "admin") {
      const [n] = await tq<{ admins: string; total: string }>(
        `SELECT count(*) FILTER (WHERE role = 'admin') AS admins, count(*) AS total FROM members WHERE community_id = $1`,
        [c.id],
      );
      if (Number(n.admins) === 1 && Number(n.total) > 1) throw new UserError("Make someone else an admin first");
    }
    await tq(`DELETE FROM members WHERE community_id = $1 AND email = $2`, [c.id, email]);
  });
}

// Posts

const MENTION = /@([^\s@<>()[\]]+@[^\s@<>()[\]]+\.[a-z]{2,})/gi;
const TOPIC = /(^|[^\p{L}\p{N}_&/])#([\p{L}\p{N}_-]{2,40})/gu;

/** Email addresses written as @name@example.com. */
export function mentionsIn(s: string): string[] {
  const out = new Set<string>();
  for (const m of s.matchAll(MENTION)) out.add(m[1].toLowerCase().replace(/[.,;:!?]+$/, ""));
  return [...out].slice(0, 50);
}

/** Topics written as #topic, lower-cased. */
export function topicsIn(s: string): string[] {
  const out = new Set<string>();
  for (const m of s.matchAll(TOPIC)) out.add(m[2].toLowerCase());
  return [...out].slice(0, 20);
}

type PostRow = {
  id: string; community_id: string | null; author: string; kind: PostKind; title: string; body: string; topics: string[];
  mentions: string[]; praised: string[]; badge: string | null; announcement: boolean; pinned: boolean; best_answer: string | null;
  created_at: Date; edited_at: Date | null; activity_at: Date;
  c_slug: string | null; c_name: string | null; c_color: string | null; c_privacy: Privacy | null; my_role: Role | null;
};

const POST_SELECT = `SELECT p.id, p.community_id, p.author, p.kind, p.title, p.body, p.topics, p.mentions, p.praised, p.badge,
  p.announcement, p.pinned, p.best_answer, p.created_at, p.edited_at, p.activity_at,
  c.slug AS c_slug, c.name AS c_name, c.color AS c_color, c.privacy AS c_privacy,
  (SELECT m.role FROM members m WHERE m.community_id = p.community_id AND m.email = $1) AS my_role
  FROM posts p LEFT JOIN communities c ON c.id = p.community_id`;

type CommentRow = { id: string; post_id: string; parent_id: string | null; author: string; body: string; mentions: string[]; created_at: Date; edited_at: Date | null };

/** Fills in reactions, comments, polls and permissions for posts the viewer can see. */
async function hydrate(viewer: string, rows: PostRow[], allComments = false): Promise<Post[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const admin = isCompanyAdmin(viewer);
  const [counts, mine, comments, options, votes, savedRows] = await Promise.all([
    q<{ target_id: string; kind: Reaction; n: string }>(
      `SELECT target_id, kind, count(*) AS n FROM reactions WHERE target_id = ANY($1::uuid[])
         OR target_id IN (SELECT id FROM comments WHERE post_id = ANY($1::uuid[])) GROUP BY target_id, kind`,
      [ids],
    ),
    q<{ target_id: string; kind: Reaction }>(
      `SELECT target_id, kind FROM reactions WHERE email = $2 AND (target_id = ANY($1::uuid[])
         OR target_id IN (SELECT id FROM comments WHERE post_id = ANY($1::uuid[])))`,
      [ids, viewer],
    ),
    q<CommentRow & { total: string; rank: string }>(
      `SELECT * FROM (
         SELECT id, post_id, parent_id, author, body, mentions, created_at, edited_at,
           count(*) OVER (PARTITION BY post_id) AS total,
           row_number() OVER (PARTITION BY post_id ORDER BY created_at DESC, id DESC) AS rank
         FROM comments WHERE post_id = ANY($1::uuid[]) AND held_deleted_at IS NULL
       ) x ${allComments ? "" : "WHERE rank <= 2"} ORDER BY created_at, id`,
      [ids],
    ),
    q<{ id: string; post_id: string; label: string; votes: string }>(
      `SELECT o.id, o.post_id, o.label, (SELECT count(*) FROM poll_votes v WHERE v.option_id = o.id) AS votes
       FROM poll_options o WHERE o.post_id = ANY($1::uuid[]) ORDER BY o.position, o.id`,
      [ids],
    ),
    q<{ post_id: string; option_id: string }>(`SELECT post_id, option_id FROM poll_votes WHERE email = $2 AND post_id = ANY($1::uuid[])`, [ids, viewer]),
    q<{ post_id: string }>(`SELECT post_id FROM saved WHERE email = $2 AND post_id = ANY($1::uuid[])`, [ids, viewer]),
  ]);

  const tally = new Map<string, Partial<Record<Reaction, number>>>();
  for (const c of counts) (tally.get(c.target_id) ?? tally.set(c.target_id, {}).get(c.target_id)!)[c.kind] = Number(c.n);
  const my = new Map(mine.map((m) => [m.target_id, m.kind]));
  const n = await names([
    ...rows.flatMap((r) => [r.author, ...r.mentions, ...r.praised]),
    ...comments.flatMap((c) => [c.author, ...c.mentions]),
  ]);
  const saved = new Set(savedRows.map((s) => s.post_id));
  const myVote = new Map(votes.map((v) => [v.post_id, v.option_id]));

  return rows.map((r): Post => {
    const moderate = admin || r.my_role === "admin";
    const own = r.author === viewer;
    const cs = comments.filter((c) => c.post_id === r.id);
    const opts = options.filter((o) => o.post_id === r.id).map((o) => ({ id: o.id, label: o.label, votes: Number(o.votes) }));
    const community: CommunityRef | null = r.community_id
      ? { id: r.community_id, slug: r.c_slug!, name: r.c_name!, color: r.c_color!, privacy: r.c_privacy! }
      : null;
    return {
      id: r.id,
      community,
      author: ref(n, r.author),
      kind: r.kind,
      title: r.title,
      body: r.body,
      topics: r.topics,
      mentions: r.mentions.map((e) => ref(n, e)),
      praised: r.praised.map((e) => ref(n, e)),
      badge: r.badge,
      announcement: r.announcement,
      pinned: r.pinned,
      bestAnswer: r.best_answer,
      createdAt: r.created_at.toISOString(),
      editedAt: r.edited_at?.toISOString() ?? null,
      activityAt: r.activity_at.toISOString(),
      reactions: tally.get(r.id) ?? {},
      myReaction: my.get(r.id) ?? null,
      commentCount: cs.length ? Number(cs[0].total) : 0,
      comments: cs.map((c): Comment => ({
        id: c.id,
        postId: c.post_id,
        parentId: c.parent_id,
        author: ref(n, c.author),
        body: c.body,
        mentions: c.mentions.map((e) => ref(n, e)),
        createdAt: c.created_at.toISOString(),
        editedAt: c.edited_at?.toISOString() ?? null,
        reactions: tally.get(c.id) ?? {},
        myReaction: my.get(c.id) ?? null,
        canEdit: c.author === viewer,
        canDelete: c.author === viewer || moderate,
      })),
      poll: r.kind === "poll" ? { options: opts, myVote: myVote.get(r.id) ?? null, total: opts.reduce((s, o) => s + o.votes, 0) } : null,
      saved: saved.has(r.id),
      can: { edit: own, delete: own || moderate, moderate: !!r.community_id && moderate, markAnswer: r.kind === "question" && (own || moderate) },
    };
  });
}

/** A post the viewer can see, with every comment. */
export async function getPost(viewer: string, id: string): Promise<Post> {
  const rows = await q<PostRow>(`${POST_SELECT} WHERE p.id = $2::uuid AND ${VISIBLE_POST}`, [viewer, uuid(id)]);
  if (!rows.length) throw new UserError("Post not found", 404);
  return (await hydrate(viewer, rows, true))[0];
}

const PAGE = 20;

function cursor(p: Post | undefined): string | null {
  return p ? Buffer.from(`${p.activityAt}|${p.id}`).toString("base64url") : null;
}

function readCursor(c: string | null | undefined): [string, string] | null {
  if (!c) return null;
  const [at, id] = Buffer.from(c, "base64url").toString().split("|");
  if (!at || Number.isNaN(Date.parse(at)) || !UUID.test(id ?? "")) throw new UserError("Bad cursor");
  return [at, id];
}

export type FeedQuery = { view?: string; community?: string; person?: string; topic?: string; cursor?: string | null; limit?: number };

/**
 * A page of posts, most recently active first.
 *   home       your communities, people you follow, your own posts and posts that name you
 *   discover   everything you can see
 *   community  one community (pinned posts first on the first page)
 *   person     someone's posts: their storyline and what they wrote in communities you can see
 *   topic      posts tagged #topic
 *   mentions   posts that mention or praise you, or with a comment that mentions you
 *   saved      posts you saved
 *   questions  open questions in your communities
 */
export async function feed(viewer: string, f: FeedQuery = {}): Promise<FeedPage> {
  const view = (f.view ?? "home") as FeedView;
  const params: unknown[] = [viewer];
  const add = (v: unknown) => `$${params.push(v)}`;
  const where = [VISIBLE_POST];
  let pinnedFirst: string | null = null;
  switch (view) {
    case "home":
      where.push(`(p.author = $1 OR p.community_id IN (SELECT community_id FROM members WHERE email = $1)
        OR p.author IN (SELECT followee FROM follows WHERE follower = $1) OR $1 = ANY(p.mentions) OR $1 = ANY(p.praised))`);
      break;
    case "discover":
      break;
    case "community": {
      const c = await getCommunity(viewer, String(f.community ?? ""));
      where.push(`p.community_id = ${add(c.id)}`);
      pinnedFirst = c.id;
      break;
    }
    case "person":
      where.push(`p.author = ${add(cleanEmail(f.person))}`);
      break;
    case "topic": {
      const t = String(f.topic ?? "").replace(/^#/, "").toLowerCase();
      if (!t) throw new UserError("Pick a topic");
      where.push(`${add(t)} = ANY(p.topics)`);
      break;
    }
    case "mentions":
      where.push(`(p.author <> $1 AND ($1 = ANY(p.mentions) OR $1 = ANY(p.praised)
        OR EXISTS (SELECT 1 FROM comments cm WHERE cm.post_id = p.id AND cm.held_deleted_at IS NULL AND $1 = ANY(cm.mentions))))`);
      break;
    case "saved":
      where.push(`p.id IN (SELECT post_id FROM saved WHERE email = $1)`);
      break;
    case "questions":
      where.push(`p.kind = 'question' AND p.best_answer IS NULL AND p.community_id IN (SELECT community_id FROM members WHERE email = $1)`);
      break;
    default:
      throw new UserError("Unknown feed");
  }
  const after = readCursor(f.cursor);
  const limit = Math.min(Math.max(Number(f.limit) || PAGE, 1), 50);
  let pinned: PostRow[] = [];
  if (pinnedFirst) {
    if (!after) pinned = await q<PostRow>(`${POST_SELECT} WHERE ${where.join(" AND ")} AND p.pinned ORDER BY p.activity_at DESC, p.id DESC`, params);
    where.push("NOT p.pinned");
  }
  if (after) where.push(`(p.activity_at, p.id) < (${add(after[0])}::timestamptz, ${add(after[1])}::uuid)`);
  const rows = await q<PostRow>(
    `${POST_SELECT} WHERE ${where.join(" AND ")} ORDER BY p.activity_at DESC, p.id DESC LIMIT ${add(limit + 1)}`,
    params,
  );
  const more = rows.length > limit;
  const posts = await hydrate(viewer, [...pinned, ...rows.slice(0, limit)]);
  return { posts, next: more ? cursor(posts[posts.length - 1]) : null };
}

export type NewPost = {
  communityId?: unknown; kind?: unknown; title?: unknown; body?: unknown; praised?: unknown; badge?: unknown;
  options?: unknown; announcement?: unknown;
};

export async function createPost(me: Me, v: NewPost): Promise<Post> {
  await touch(me);
  const kind = (KINDS as string[]).includes(String(v.kind ?? "discussion")) ? (String(v.kind ?? "discussion") as PostKind) : null;
  if (!kind) throw new UserError("Unknown kind of post");
  const body = text(v.body, 20_000);
  const title = text(v.title, 200);
  let community: Community | null = null;
  if (v.communityId) {
    community = await getCommunity(me.email, uuid(v.communityId, "Community"));
    if (!community.myRole && !isCompanyAdmin(me.email)) throw new UserError("Join the community to post in it", 403);
  }
  const announcement = v.announcement === true;
  if (announcement) {
    if (!community) throw new UserError("Announcements go to a community");
    if (!community.canManage) throw new UserError("Only the community's admins can make announcements", 403);
  }
  if (kind === "article" && !title) throw new UserError("Give the article a title");
  if (kind === "question" && !body && !title) throw new UserError("Ask your question");
  let praised: string[] = [];
  let badge: string | null = null;
  if (kind === "praise") {
    praised = [...new Set((Array.isArray(v.praised) ? v.praised : []).map((e) => String(e).trim().toLowerCase()).filter(isEmail))]
      .filter((e) => e !== me.email)
      .slice(0, 20);
    if (!praised.length) throw new UserError("Choose who you're praising");
    badge = typeof v.badge === "string" && v.badge in BADGES ? v.badge : "thank-you";
  }
  let options: string[] = [];
  if (kind === "poll") {
    options = (Array.isArray(v.options) ? v.options : []).map((o) => text(o, 120)).filter(Boolean);
    options = [...new Set(options)];
    if (options.length < 2) throw new UserError("A poll needs at least two choices");
    if (options.length > 10) throw new UserError("A poll can have up to ten choices");
    if (!body && !title) throw new UserError("Ask the poll's question");
  }
  if (!body && !title && kind !== "praise") throw new UserError("Write something first");
  const all = `${title}\n${body}`;
  const id = await tx(async (tq) => {
    const [row] = await tq<{ id: string }>(
      `INSERT INTO posts (community_id, author, kind, title, body, topics, mentions, praised, badge, announcement)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [community?.id ?? null, me.email, kind, title, body, topicsIn(all), mentionsIn(all).filter((e) => e !== me.email), praised, badge, announcement],
    );
    for (const [i, label] of options.entries()) {
      await tq(`INSERT INTO poll_options (post_id, label, position) VALUES ($1, $2, $3)`, [row.id, label, i]);
    }
    return row.id;
  });
  return getPost(me.email, id);
}

export async function updatePost(me: Me, id: string, v: { title?: unknown; body?: unknown; pinned?: unknown; announcement?: unknown }): Promise<Post> {
  const p = await getPost(me.email, id);
  if (v.title !== undefined || v.body !== undefined) {
    if (!p.can.edit) throw new UserError("Only the author can edit a post", 403);
    const title = v.title === undefined ? p.title : text(v.title, 200);
    const body = v.body === undefined ? p.body : text(v.body, 20_000);
    if (p.kind === "article" && !title) throw new UserError("Give the article a title");
    if (!title && !body && p.kind !== "praise") throw new UserError("Write something first");
    const all = `${title}\n${body}`;
    await q(
      `UPDATE posts SET title = $2, body = $3, topics = $4, mentions = $5, edited_at = now() WHERE id = $1`,
      [p.id, title, body, topicsIn(all), mentionsIn(all).filter((e) => e !== me.email)],
    );
  }
  if (v.pinned !== undefined || v.announcement !== undefined) {
    if (!p.can.moderate) throw new UserError("Only the community's admins can pin posts or make announcements", 403);
    await q(
      `UPDATE posts SET pinned = COALESCE($2, pinned), announcement = COALESCE($3, announcement) WHERE id = $1`,
      [p.id, v.pinned === undefined ? null : v.pinned === true, v.announcement === undefined ? null : v.announcement === true],
    );
  }
  return getPost(me.email, p.id);
}

/** Deletes a post, or hides it and keeps it when anyone who wrote in it is on legal hold. */
export async function deletePost(me: Me, id: string): Promise<void> {
  const p = await getPost(me.email, id);
  if (!p.can.delete) throw new UserError("Only the author or the community's admins can delete this", 403);
  const writers = await q<{ author: string }>(`SELECT author FROM posts WHERE id = $1 UNION SELECT author FROM comments WHERE post_id = $1`, [p.id]);
  const held = holdChecker();
  for (const w of writers) {
    if (await held(w.author)) {
      await q(`UPDATE posts SET held_deleted_at = now() WHERE id = $1`, [p.id]);
      return;
    }
  }
  await tx(async (tq) => {
    await tq(`DELETE FROM reactions WHERE target_id = $1 OR target_id IN (SELECT id FROM comments WHERE post_id = $1)`, [p.id]);
    await tq(`DELETE FROM posts WHERE id = $1`, [p.id]);
  });
}

// Replies, reactions, polls

export async function addComment(me: Me, postId: string, v: { body?: unknown; parentId?: unknown }): Promise<Comment> {
  await touch(me);
  const p = await getPost(me.email, postId);
  const body = text(v.body, 10_000);
  if (!body) throw new UserError("Write a reply first");
  let parent: string | null = null;
  if (v.parentId) {
    const id = uuid(v.parentId, "Reply");
    const [c] = await q<{ parent_id: string | null }>(
      `SELECT parent_id FROM comments WHERE id = $1 AND post_id = $2 AND held_deleted_at IS NULL`,
      [id, p.id],
    );
    if (!c) throw new UserError("Reply not found", 404);
    // Replies are one level deep: answering a reply joins its thread.
    parent = c.parent_id ?? id;
  }
  const [row] = await tx(async (tq) => {
    const out = await tq<{ id: string }>(
      `INSERT INTO comments (post_id, parent_id, author, body, mentions) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [p.id, parent, me.email, body, mentionsIn(body).filter((e) => e !== me.email)],
    );
    await tq(`UPDATE posts SET activity_at = now() WHERE id = $1`, [p.id]);
    return out;
  });
  return (await getPost(me.email, p.id)).comments.find((c) => c.id === row.id)!;
}

async function commentFor(me: Me, id: string): Promise<{ post: Post; comment: Comment }> {
  const cid = uuid(id, "Reply");
  const [row] = await q<{ post_id: string }>(`SELECT post_id FROM comments WHERE id = $1 AND held_deleted_at IS NULL`, [cid]);
  if (!row) throw new UserError("Reply not found", 404);
  const post = await getPost(me.email, row.post_id);
  return { post, comment: post.comments.find((c) => c.id === cid)! };
}

export async function editComment(me: Me, id: string, v: { body?: unknown }): Promise<Comment> {
  const { comment } = await commentFor(me, id);
  if (!comment.canEdit) throw new UserError("Only the author can edit a reply", 403);
  const body = text(v.body, 10_000);
  if (!body) throw new UserError("Write a reply first");
  await q(`UPDATE comments SET body = $2, mentions = $3, edited_at = now() WHERE id = $1`, [comment.id, body, mentionsIn(body).filter((e) => e !== me.email)]);
  return (await commentFor(me, id)).comment;
}

/** Deletes a reply and the replies under it, or hides them when one of their writers is on legal hold. */
export async function deleteComment(me: Me, id: string): Promise<void> {
  const { post, comment } = await commentFor(me, id);
  if (!comment.canDelete) throw new UserError("Only the author or the community's admins can delete this", 403);
  const writers = await q<{ author: string }>(`SELECT DISTINCT author FROM comments WHERE id = $1 OR parent_id = $1`, [comment.id]);
  const held = holdChecker();
  let keep = false;
  for (const w of writers) if (await held(w.author)) keep = true;
  await tx(async (tq) => {
    if (keep) {
      await tq(`UPDATE comments SET held_deleted_at = now() WHERE id = $1 OR parent_id = $1`, [comment.id]);
    } else {
      await tq(`DELETE FROM reactions WHERE target_id = $1 OR target_id IN (SELECT id FROM comments WHERE parent_id = $1)`, [comment.id]);
      await tq(`DELETE FROM comments WHERE id = $1`, [comment.id]);
    }
    if (post.bestAnswer === comment.id) await tq(`UPDATE posts SET best_answer = NULL WHERE id = $1`, [post.id]);
  });
}

/** Sets or clears the viewer's reaction on a post or a reply they can see. */
export async function react(me: Me, targetId: string, kind: unknown): Promise<void> {
  const id = uuid(targetId);
  const [post] = await q<{ id: string }>(`SELECT p.id FROM posts p WHERE p.id = $2 AND ${VISIBLE_POST}`, [me.email, id]);
  if (!post) await commentFor(me, id);
  if (kind === null || kind === "" || kind === undefined) {
    await q(`DELETE FROM reactions WHERE target_id = $1 AND email = $2`, [id, me.email]);
    return;
  }
  if (!(REACTIONS as readonly string[]).includes(String(kind))) throw new UserError("Unknown reaction");
  await q(
    `INSERT INTO reactions (target_id, email, kind) VALUES ($1, $2, $3) ON CONFLICT (target_id, email) DO UPDATE SET kind = EXCLUDED.kind, at = now()`,
    [id, me.email, kind],
  );
}

/** Votes in a poll, changes the vote, or takes it back with a null option. */
export async function vote(me: Me, postId: string, optionId: unknown): Promise<Post> {
  const p = await getPost(me.email, postId);
  if (!p.poll) throw new UserError("That post isn't a poll");
  if (optionId === null || optionId === undefined || optionId === "") {
    await q(`DELETE FROM poll_votes WHERE post_id = $1 AND email = $2`, [p.id, me.email]);
  } else {
    const opt = p.poll.options.find((o) => o.id === optionId);
    if (!opt) throw new UserError("Choice not found", 404);
    await q(
      `INSERT INTO poll_votes (post_id, option_id, email) VALUES ($1, $2, $3) ON CONFLICT (post_id, email) DO UPDATE SET option_id = EXCLUDED.option_id`,
      [p.id, opt.id, me.email],
    );
  }
  return getPost(me.email, p.id);
}

/** The question's author or a moderator marks the reply that answered it (null to clear). */
export async function markAnswer(me: Me, postId: string, commentId: unknown): Promise<Post> {
  const p = await getPost(me.email, postId);
  if (!p.can.markAnswer) throw new UserError("Only whoever asked can choose the best answer", 403);
  const id = commentId ? uuid(commentId, "Reply") : null;
  if (id && !p.comments.some((c) => c.id === id)) throw new UserError("Reply not found", 404);
  await q(`UPDATE posts SET best_answer = $2 WHERE id = $1`, [p.id, id]);
  return getPost(me.email, p.id);
}

export async function save(me: Me, postId: string, on: boolean): Promise<void> {
  const p = await getPost(me.email, postId);
  if (on) await q(`INSERT INTO saved (email, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [me.email, p.id]);
  else await q(`DELETE FROM saved WHERE email = $1 AND post_id = $2`, [me.email, p.id]);
}

// The company home page

export async function quickLinks(): Promise<QuickLink[]> {
  return q<QuickLink>(`SELECT id, label, url, position FROM quick_links ORDER BY position, created_at`);
}

function requireAdmin(me: Me): void {
  if (!isCompanyAdmin(me.email)) throw new UserError("Only a company admin can change the home page", 403);
}

export async function addQuickLink(me: Me, v: { label?: unknown; url?: unknown }): Promise<QuickLink> {
  requireAdmin(me);
  const label = text(v.label, 80);
  const url = link(v.url);
  if (!label || !url) throw new UserError("Give the link a name and an address");
  const [row] = await q<QuickLink>(
    `INSERT INTO quick_links (label, url, position, created_by)
     VALUES ($1, $2, COALESCE((SELECT max(position) + 1 FROM quick_links), 0), $3) RETURNING id, label, url, position`,
    [label, url, me.email],
  );
  return row;
}

export async function updateQuickLink(me: Me, id: string, v: { label?: unknown; url?: unknown; position?: unknown }): Promise<void> {
  requireAdmin(me);
  const label = v.label === undefined ? null : text(v.label, 80);
  if (label === "") throw new UserError("Give the link a name");
  await q(
    `UPDATE quick_links SET label = COALESCE($2, label), url = COALESCE($3, url), position = COALESCE($4, position) WHERE id = $1`,
    [uuid(id, "Link"), label, v.url === undefined ? null : link(v.url), v.position === undefined ? null : Math.trunc(Number(v.position)) || 0],
  );
}

export async function deleteQuickLink(me: Me, id: string): Promise<void> {
  requireAdmin(me);
  await q(`DELETE FROM quick_links WHERE id = $1`, [uuid(id, "Link")]);
}

/**
 * The intranet home page: announcements and articles from communities the viewer can see, the
 * company's quick links, their communities, ones they might join, trending topics and new people.
 */
export async function home(me: Me): Promise<Home> {
  await touch(me);
  const newsRows = await q<PostRow>(
    `${POST_SELECT} WHERE ${VISIBLE_POST} AND (p.announcement OR p.kind = 'article') AND p.created_at > now() - interval '90 days'
     ORDER BY p.announcement DESC, p.created_at DESC LIMIT 6`,
    [me.email],
  );
  const [news, links, mine, all, topics, fresh] = await Promise.all([
    hydrate(me.email, newsRows),
    quickLinks(),
    communities(me.email, { mine: true }),
    communities(me.email),
    q<{ topic: string; posts: string }>(
      `SELECT t AS topic, count(*) AS posts FROM posts p, unnest(p.topics) t
       WHERE ${VISIBLE_POST} AND p.activity_at > now() - interval '14 days' GROUP BY t ORDER BY count(*) DESC, t LIMIT 8`,
      [me.email],
    ),
    q<{ email: string; name: string }>(`SELECT email, name FROM people WHERE email <> $1 ORDER BY last_seen DESC LIMIT 8`, [me.email]),
  ]);
  mine.sort((a, b) => Number(b.official) - Number(a.official) || (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""));
  return {
    me: { email: me.email, name: me.name, admin: isCompanyAdmin(me.email) },
    company: companyName(),
    news,
    quickLinks: links,
    communities: mine.slice(0, 8),
    suggested: all.filter((c) => !c.myRole && c.privacy === "public").sort((a, b) => b.members - a.members).slice(0, 4),
    topics: topics.map((t) => ({ topic: t.topic, posts: Number(t.posts) })),
    people: fresh,
  };
}
