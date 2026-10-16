/**
 * SynergyBoards — data model (Drizzle / Postgres).
 *
 * Trello parity (workspaces → boards → lists → cards, with labels, checklists, members,
 * comments, attachments, activity) PLUS the AI-native layer that is the whole reason we own
 * this instead of forking Planka:
 *   - cards/comments carry an `origin` (human | mind) and `mindRef` so the mind's proposals,
 *     goals, and code-review findings become FIRST-CLASS cards it can file, move, and annotate.
 *   - `automations` = Butler-style rules the mind can propose + (governed) execute.
 *   - attachments link to SynergyDrive by fileId (one workspace, two products).
 *
 * Positions use doublePrecision for fractional indexing (drop between two cards = average of
 * neighbours) so reordering never rewrites the whole list.
 */
import {
  boolean, doublePrecision, index, integer, jsonb, pgEnum, pgTable, primaryKey,
  text, timestamp, unique, uuid,
} from "drizzle-orm/pg-core";

export const memberRole = pgEnum("member_role", ["owner", "admin", "member", "observer"]);
export const origin = pgEnum("origin", ["human", "mind"]);          // who created it
// Jira-style issue tracking:
export const issueType = pgEnum("issue_type", ["epic", "story", "task", "bug", "subtask"]);
export const priority = pgEnum("priority", ["highest", "high", "medium", "low", "lowest"]);
export const sprintState = pgEnum("sprint_state", ["future", "active", "completed"]);
export const activityType = pgEnum("activity_type", [
  "card_created", "card_moved", "card_updated", "card_archived", "comment_added",
  "member_added", "label_added", "checklist_updated", "due_changed", "automation_ran",
  // History parity with Trello's activity feed and Jira's History tab. Appended, never reordered:
  // Postgres enum values can be added in place but not removed or reordered.
  "card_deleted", "card_restored", "comment_edited", "comment_deleted", "label_removed",
  "member_removed", "checklist_added", "list_created", "list_updated", "list_archived",
  "sprint_started", "sprint_completed", "attachment_added", "attachment_removed",
  "link_added", "link_removed",
]);
// Jira issue-link types. Directional ones read differently from each end (blocks / is blocked by);
// the labels live in lib/links.ts, not here, so wording can change without a migration.
export const linkType = pgEnum("link_type", ["blocks", "relates", "duplicates", "clones"]);
// Jira workflow: every status (list) belongs to a category, and a Done-category status resolves the issue.
export const statusCategory = pgEnum("status_category", ["todo", "in_progress", "done"]);
export const resolution = pgEnum("resolution", ["done", "wont_do", "duplicate", "cannot_reproduce"]);
// Jira per-project custom fields.
export const customFieldType = pgEnum("custom_field_type", ["text", "number", "select", "date", "user", "checkbox"]);
export const notificationType = pgEnum("notification_type", ["assigned", "mentioned", "commented", "updated"]);

/* ---- identity (users are provisioned from SynergyAuth via OIDC sub) ---- */
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  authSub: text("auth_sub").unique(),                // SynergyAuth OIDC subject (null for the mind)
  email: text("email"),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  isMind: boolean("is_mind").notNull().default(false), // the mind acts as a first-class member
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ---- workspaces / teams ---- */
export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceMembers = pgTable("workspace_members", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: memberRole("role").notNull().default("member"),
}, (t) => ({ pk: primaryKey({ columns: [t.workspaceId, t.userId] }) }));

/* ---- boards ---- */
export const boards = pgTable("boards", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  background: text("background"),                    // color or image key
  keyPrefix: text("key_prefix").notNull().default("SYN"),  // issue-key prefix, e.g. SYN-123
  seq: integer("seq").notNull().default(0),          // per-board issue counter
  isClosed: boolean("is_closed").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ wsIdx: index("boards_ws_idx").on(t.workspaceId) }));

/* ---- sprints (agile) ---- */
export const sprints = pgTable("sprints", {
  id: uuid("id").defaultRandom().primaryKey(),
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  goal: text("goal"),
  state: sprintState("state").notNull().default("future"),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ boardIdx: index("sprints_board_idx").on(t.boardId) }));

export const boardMembers = pgTable("board_members", {
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: memberRole("role").notNull().default("member"),
}, (t) => ({ pk: primaryKey({ columns: [t.boardId, t.userId] }) }));

/* ---- starred boards (per person; changes nothing anyone else sees) ---- */
export const boardStars = pgTable("board_stars", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.boardId] }) }));

/* ---- lists (columns) ---- */
export const lists = pgTable("lists", {
  id: uuid("id").defaultRandom().primaryKey(),
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  position: doublePrecision("position").notNull(),
  isArchived: boolean("is_archived").notNull().default(false),
  wipLimit: integer("wip_limit"),                    // Kanban WIP limit; null = none. Shown, not enforced, as in Jira.
  statusCategory: statusCategory("status_category").notNull().default("todo"),
}, (t) => ({ boardIdx: index("lists_board_idx").on(t.boardId) }));

/* ---- cards ---- */
export const cards = pgTable("cards", {
  id: uuid("id").defaultRandom().primaryKey(),
  listId: uuid("list_id").notNull().references(() => lists.id, { onDelete: "cascade" }),
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  position: doublePrecision("position").notNull(),
  startDate: timestamp("start_date", { withTimezone: true }),
  dueDate: timestamp("due_date", { withTimezone: true }),
  isComplete: boolean("is_complete").notNull().default(false),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  resolution: resolution("resolution"),                // set only while complete; why it was closed  // stamped when isComplete flips true; a real burndown is impossible without it
  isArchived: boolean("is_archived").notNull().default(false),
  cover: text("cover"),                              // "#rrggbb" colour, or the id of an image attachment on this card
  // Jira-style issue fields:
  issueKey: text("issue_key"),                       // e.g. SYN-123 (assigned at creation)
  issueType: issueType("issue_type").notNull().default("task"),
  priority: priority("priority").notNull().default("medium"),
  points: integer("points"),                         // story points
  // Time tracking, in minutes (lib/duration parses Jira shorthand like "1d 4h").
  originalEstimate: integer("original_estimate"),
  remainingEstimate: integer("remaining_estimate"),
  timeSpent: integer("time_spent").notNull().default(0),
  parentId: uuid("parent_id"),                       // epic/story parent (self-ref, app-enforced)
  sprintId: uuid("sprint_id"),                        // current sprint (null = backlog)
  origin: origin("origin").notNull().default("human"),
  mindRef: text("mind_ref"),                         // links a mind card back to ready_queue id / objective id
  // Jira's single owner and the person who raised it. Trello-style `card_members` stays alongside:
  // members are "who is involved", the assignee is "whose it is".
  assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
  reporterId: uuid("reporter_id").references(() => users.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ listIdx: index("cards_list_idx").on(t.listId), boardIdx: index("cards_board_idx").on(t.boardId) }));

/* ---- issue links (may join cards on different boards; readers only ever see ends they can see) ---- */
export const issueLinks = pgTable("issue_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceId: uuid("source_id").notNull().references(() => cards.id, { onDelete: "cascade" }),
  targetId: uuid("target_id").notNull().references(() => cards.id, { onDelete: "cascade" }),
  type: linkType("type").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniq: unique("issue_links_unique").on(t.sourceId, t.targetId, t.type),
  targetIdx: index("issue_links_target_idx").on(t.targetId),
}));

/* ---- sprint snapshots (what a sprint held when it was completed) ---- */
export const sprintReports = pgTable("sprint_reports", {
  sprintId: uuid("sprint_id").primaryKey().references(() => sprints.id, { onDelete: "cascade" }),
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  committedPoints: integer("committed_points").notNull().default(0),
  completedPoints: integer("completed_points").notNull().default(0),
  committedCards: integer("committed_cards").notNull().default(0),
  completedCards: integer("completed_cards").notNull().default(0),
  returnedCards: integer("returned_cards").notNull().default(0),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ---- components and versions (Jira; each belongs to one board, like a label) ---- */
export const components = pgTable("components", {
  id: uuid("id").defaultRandom().primaryKey(),
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  leadId: uuid("lead_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniq: unique("components_board_name").on(t.boardId, t.name) }));

export const cardComponents = pgTable("card_components", {
  cardId: uuid("card_id").notNull().references(() => cards.id, { onDelete: "cascade" }),
  componentId: uuid("component_id").notNull().references(() => components.id, { onDelete: "cascade" }),
}, (t) => ({ pk: primaryKey({ columns: [t.cardId, t.componentId] }) }));

export const versions = pgTable("versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  startDate: timestamp("start_date", { withTimezone: true }),
  releaseDate: timestamp("release_date", { withTimezone: true }),   // planned
  releasedAt: timestamp("released_at", { withTimezone: true }),     // actual; null = unreleased
  isArchived: boolean("is_archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniq: unique("versions_board_name").on(t.boardId, t.name) }));

export const cardFixVersions = pgTable("card_fix_versions", {
  cardId: uuid("card_id").notNull().references(() => cards.id, { onDelete: "cascade" }),
  versionId: uuid("version_id").notNull().references(() => versions.id, { onDelete: "cascade" }),
}, (t) => ({ pk: primaryKey({ columns: [t.cardId, t.versionId] }) }));

/* ---- custom fields (per board, like labels) ---- */
export const customFields = pgTable("custom_fields", {
  id: uuid("id").defaultRandom().primaryKey(),
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: customFieldType("type").notNull(),
  options: jsonb("options").$type<string[]>(),        // select only
  position: doublePrecision("position").notNull().default(1024),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniq: unique("custom_fields_board_name").on(t.boardId, t.name) }));

export const cardFieldValues = pgTable("card_field_values", {
  cardId: uuid("card_id").notNull().references(() => cards.id, { onDelete: "cascade" }),
  fieldId: uuid("field_id").notNull().references(() => customFields.id, { onDelete: "cascade" }),
  value: jsonb("value").notNull(),                    // text | number | boolean | ISO date | user id
}, (t) => ({ pk: primaryKey({ columns: [t.cardId, t.fieldId] }) }));

/* ---- saved searches (Jira filters; personal for now — sharing is a later change) ---- */
export const savedFilters = pgTable("saved_filters", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  query: text("query").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniq: unique("saved_filters_user_name").on(t.userId, t.name) }));

/* ---- work logs (Jira worklog) ---- */
export const workLogs = pgTable("work_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  cardId: uuid("card_id").notNull().references(() => cards.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  minutes: integer("minutes").notNull(),
  comment: text("comment"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ cardIdx: index("work_logs_card_idx").on(t.cardId) }));

/* ---- watchers and notifications ---- */
export const cardWatchers = pgTable("card_watchers", {
  cardId: uuid("card_id").notNull().references(() => cards.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (t) => ({ pk: primaryKey({ columns: [t.cardId, t.userId] }) }));

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),   // recipient
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  type: notificationType("type").notNull(),
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  cardId: uuid("card_id").references(() => cards.id, { onDelete: "cascade" }),
  data: jsonb("data"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ userIdx: index("notifications_user_idx").on(t.userId, t.createdAt) }));

/* ---- labels ---- */
export const labels = pgTable("labels", {
  id: uuid("id").defaultRandom().primaryKey(),
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  name: text("name"),
  color: text("color").notNull(),
}, (t) => ({ boardIdx: index("labels_board_idx").on(t.boardId) }));

export const cardLabels = pgTable("card_labels", {
  cardId: uuid("card_id").notNull().references(() => cards.id, { onDelete: "cascade" }),
  labelId: uuid("label_id").notNull().references(() => labels.id, { onDelete: "cascade" }),
}, (t) => ({ pk: primaryKey({ columns: [t.cardId, t.labelId] }) }));

export const cardMembers = pgTable("card_members", {   // assignees
  cardId: uuid("card_id").notNull().references(() => cards.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (t) => ({ pk: primaryKey({ columns: [t.cardId, t.userId] }) }));

/* ---- checklists ---- */
export const checklists = pgTable("checklists", {
  id: uuid("id").defaultRandom().primaryKey(),
  cardId: uuid("card_id").notNull().references(() => cards.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  position: doublePrecision("position").notNull(),
});

export const checklistItems = pgTable("checklist_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  checklistId: uuid("checklist_id").notNull().references(() => checklists.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  isChecked: boolean("is_checked").notNull().default(false),
  position: doublePrecision("position").notNull(),
  assigneeId: uuid("assignee_id").references(() => users.id),
  dueDate: timestamp("due_date", { withTimezone: true }),
});

/* ---- comments (mind can author) ---- */
export const comments = pgTable("comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  cardId: uuid("card_id").notNull().references(() => cards.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id),
  origin: origin("origin").notNull().default("human"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp("edited_at", { withTimezone: true }),   // shown as "(edited)"; the original is not kept
}, (t) => ({ cardIdx: index("comments_card_idx").on(t.cardId) }));

/* ---- attachments (link to SynergyDrive by fileId, or an external URL) ---- */
export const attachments = pgTable("attachments", {
  id: uuid("id").defaultRandom().primaryKey(),
  cardId: uuid("card_id").notNull().references(() => cards.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  driveFileId: text("drive_file_id"),                // → SynergyDrive
  url: text("url"),                                  // a link attachment; null for an uploaded file
  // An uploaded file: the key is generated by lib/attachment-store, never taken from the filename.
  storageKey: text("storage_key"),
  sizeBytes: integer("size_bytes"),
  mime: text("mime"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ cardIdx: index("attachments_card_idx").on(t.cardId) }));

/* ---- activity feed ---- */
export const activities = pgTable("activities", {
  id: uuid("id").defaultRandom().primaryKey(),
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  cardId: uuid("card_id").references(() => cards.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id),
  type: activityType("type").notNull(),
  data: jsonb("data"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  boardIdx: index("activities_board_idx").on(t.boardId, t.createdAt),
  cardIdx: index("activities_card_idx").on(t.cardId, t.createdAt),
}));

/* ---- invitations ----
 * The gap that made this product single-player: ownWorkspace() puts every new user in their OWN
 * workspace, and visibleBoardIds() is board-members UNION workspace-members — so with no way to
 * join someone to a workspace, a second person could never reach your boards at all.
 *
 * Addressed to an EMAIL, not a user id, because the invitee usually has no row yet: users are
 * provisioned from SynergyAuth on first sign-in. The token is what the acceptance link carries, so
 * it is unique and looked up directly. An invite grants workspace membership (access) and
 * optionally a board role; acceptedAt/revokedAt are nullable rather than a status enum so an
 * accepted invite keeps its audit trail instead of being mutated in place.
 */
export const invites = pgTable("invites", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  boardId: uuid("board_id").references(() => boards.id, { onDelete: "cascade" }), // null = workspace-only
  email: text("email").notNull(),
  role: memberRole("role").notNull().default("member"),
  token: text("token").notNull().unique(),
  invitedBy: uuid("invited_by").references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedBy: uuid("accepted_by").references(() => users.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  wsIdx: index("invites_ws_idx").on(t.workspaceId),
  emailIdx: index("invites_email_idx").on(t.email),
}));

/* ---- automations (Butler-style; the mind can propose + governed-execute) ---- */
export const automations = pgTable("automations", {
  id: uuid("id").defaultRandom().primaryKey(),
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  trigger: jsonb("trigger").notNull(),               // e.g. {on:"card_moved", toList:"Done"}
  action: jsonb("action").notNull(),                 // e.g. {do:"comment", text:"..."} | {do:"assign"}
  origin: origin("origin").notNull().default("human"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ boardIdx: index("automations_board_idx").on(t.boardId) }));
