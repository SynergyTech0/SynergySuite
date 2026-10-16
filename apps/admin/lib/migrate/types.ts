// Shapes the migration API returns; shared with the browser screens.

export type SourceKind = "m365" | "imap";

export type SourceSummary = {
  id: string; kind: SourceKind; name: string; createdBy: string; createdAt: string;
  /** m365: tenantId, clientId. imap: host, port, secure. Never the secret. */
  config: Record<string, string | number | boolean>;
  discoveredAt: string | null; discoveryError: string | null; notes: string[];
  userCount: number; mapped: number; siteCount: number;
  jobCounts: { queued: number; running: number; done: number; failed: number };
};

export type MigrationUser = {
  extId: string; email: string; name: string; enabled: boolean;
  mailBytes: number | null; mailItems: number | null; driveBytes: number | null;
  hasMailbox: boolean | null; hasDrive: boolean | null;
  target: string | null; hasPassword: boolean;
  /** Whether the target has a suite account (null when the directory isn't connected). */
  targetExists: boolean | null;
  lastJob: JobSummary | null;
};

export type MigrationSite = {
  siteId: string; name: string; url: string; driveBytes: number | null; libraries: number | null;
  members: { email: string; role: "owner" | "member" }[]; include: boolean; library: string;
  lastJob: JobSummary | null;
};

export type Workload = "mail" | "files" | "calendar" | "contacts" | "todo" | "library";
export const USER_WORKLOADS: Workload[] = ["mail", "files", "calendar", "contacts", "todo"];
export const WORKLOAD_LABEL: Record<Workload, string> = {
  mail: "Mail", files: "OneDrive", calendar: "Calendar", contacts: "Contacts", todo: "To Do", library: "SharePoint library",
};

export type Counts = { copied: number; updated: number; deleted: number; skipped: number; failed: number };
export type Report = {
  counts: Partial<Record<Workload, Counts>>;
  skipped: { workload: Workload; item: string; reason: string }[];
  errors: { workload: Workload; item: string; error: string }[];
  notMigrated: string[];
  throttled: number;
  runs: number;
};

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type JobSummary = {
  id: string; sourceId: string; subjectKind: "user" | "site"; subjectId: string; label: string; target: string;
  workloads: Workload[]; status: JobStatus; attempts: number; error: string | null;
  createdBy: string; createdAt: string; startedAt: string | null; finishedAt: string | null;
  progress: { workload?: Workload; step?: string; done?: Partial<Record<Workload, number>> };
  report: Report;
};

export type SourceDetail = SourceSummary & {
  /** Everyone discovered (or added, for IMAP), each site, and the newest 200 copies. */
  users: MigrationUser[]; sites: MigrationSite[]; jobs: JobSummary[]; directory: boolean;
};

/** What isn't copied yet, listed in every Microsoft 365 report. */
export const NOT_MIGRATED = [
  "Teams chats and channel messages",
  "OneNote notebooks",
  "Planner plans",
  "Mailbox rules, signatures and automatic replies",
  "Shared and group mailboxes (copy them as a user)",
  "Sharing on individual OneDrive files",
];
