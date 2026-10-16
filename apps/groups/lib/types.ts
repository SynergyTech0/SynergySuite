export type Kind = "team" | "distribution" | "shared_mailbox" | "security";
export const KINDS_ALL: Kind[] = ["team", "distribution", "shared_mailbox", "security"];

export const KIND_LABEL: Record<Kind, string> = {
  team: "Team",
  distribution: "Distribution list",
  shared_mailbox: "Shared mailbox",
  security: "Security group",
};

export type Role = "owner" | "member";
/** What the viewer is to a group: an owner, a member (directly or through a nested group), or nothing. Admins act as owners. */
export type Standing = Role | "admin" | null;

export type GroupSummary = {
  id: string;
  kind: Kind;
  name: string;
  description: string;
  email: string | null;
  privacy: "private" | "public";
  members: number;
  role: Standing;
  requested?: boolean;
  deletedAt?: string | null;
};

export type Member = {
  member: string;
  /** For a nested group: its name and kind. */
  group?: { id: string; name: string; kind: Kind } | null;
  role: Role;
  addedBy: string;
  addedAt: string;
};

export type Channel = { key: string; name: string; topic: string; url?: string };

export type Resource = { app: string; ref: string; name: string; url: string; status: "ok" | "error" | "off"; error: string; syncedAt: string };

export type GroupDetail = GroupSummary & {
  allowExternal: boolean;
  createdBy: string;
  createdAt: string;
  owners: string[];
  directMembers: Member[];
  channels: Channel[];
  resources: Resource[];
  requests: { email: string; message: string; createdAt: string }[];
  syncedAt: string | null;
};
