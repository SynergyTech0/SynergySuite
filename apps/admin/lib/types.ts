// Shapes the Admin center's API returns; shared with the browser screens.
import type { Role } from "./access";

export type Me = { email: string; name: string; role: Role };

export type Matter = {
  id: string; name: string; description: string; status: "open" | "closed"; owner: string; members: string[];
  createdBy: string; createdAt: string; closedBy: string | null; closedAt: string | null;
  activeHolds: number; custodians: number;
};

export type HoldRecord = {
  id: string; matterId: string; matterName: string; matterStatus: "open" | "closed"; name: string;
  custodians: string[]; apps: string[]; active: boolean;
  createdBy: string; createdAt: string; releasedBy: string | null; releasedAt: string | null;
};

export type SavedSearch = {
  id: string; matterId: string; name: string; query: string; custodians: string[]; apps: string[];
  from: string | null; to: string | null; counts: Record<string, number>; createdBy: string; createdAt: string;
};

export type ExportStatus = "pending" | "running" | "done" | "failed";
export type ExportRecord = {
  id: string; matterId: string; searchId: string | null; searchName: string; status: ExportStatus; requestedBy: string;
  createdAt: string; startedAt: string | null; finishedAt: string | null; fileName: string | null; size: number | null;
  sha256: string | null; counts: Record<string, { items: number; truncated?: boolean; error?: string }>; error: string | null;
};

export type RetentionRuleRecord = { id: string; app: string; kind: string; days: number; createdBy: string; createdAt: string };

export type MatterDetail = Matter & { holds: HoldRecord[]; searches: SavedSearch[]; exports: ExportRecord[] };
