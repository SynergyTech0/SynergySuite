/**
 * The compliance protocol. The Admin center keeps matters, legal holds and retention policies;
 * each app that stores people's content answers two calls from it and asks it one question.
 *
 * Admin → app (Bearer COMPLIANCE_TOKEN, over the internal network):
 *   POST /api/compliance/search   SearchRequest → SearchResponse
 *   POST /api/compliance/export   { ids: string[] } → { items: ExportItem[] }
 *
 * App → Admin (same token):
 *   GET  {ADMIN_INTERNAL_URL}/api/svc/policy → Policy
 *
 * An app must not permanently delete content whose owner is on hold (see PolicyClient.onHold),
 * and keeps what a held person deletes, hidden from them but still found by search. Retention
 * policies say how long content may live; an app deletes past it only when the owner is not on hold.
 *
 * The same feed carries the sensitivity labels (labels.ts) and data loss prevention rules
 * (dlp.ts). Apps report DLP matches back:
 *   POST {ADMIN_INTERNAL_URL}/api/svc/dlp/incidents   DlpIncident
 */
import type { DlpSettings } from "./dlp";
import type { LabelSettings } from "./labels";

/** An app's own name for a kind of content, e.g. "message", "file", "ticket". */
export type Kind = string;

export interface SearchRequest {
  /** Keywords: words must all appear; "quoted phrases", OR between alternatives, -word to exclude. */
  query?: string;
  /** Limit to content these people own, sent or received (lower-case emails). Empty = everyone. */
  custodians?: string[];
  /** ISO dates, inclusive, on the content's own date (sent, modified, created). */
  from?: string;
  to?: string;
  /** Limit to some of the app's kinds. Empty = all. */
  kinds?: Kind[];
  /** Page size; apps cap it at MAX_PAGE. */
  limit?: number;
  /** Opaque, from the previous page's nextCursor. */
  cursor?: string;
}

export interface SearchHit {
  /** Stable within the app; the Admin center passes it back to export. */
  id: string;
  kind: Kind;
  title: string;
  /** Email of the person the content belongs to. */
  owner: string;
  /** Everyone else on it: recipients, members, assignees (lower-case emails). */
  participants?: string[];
  /** ISO timestamp. */
  date: string;
  snippet: string;
  size?: number;
  /** True when the owner deleted it while on hold and the app kept it. */
  deleted?: boolean;
}

export interface SearchResponse {
  app: string;
  hits: SearchHit[];
  /** Total matches when cheap to count; otherwise omitted. */
  total?: number;
  nextCursor?: string;
}

export interface ExportAttachment {
  name: string;
  type: string;
  /** Base64 content, or omitted with `skipped` when larger than MAX_ATTACHMENT_BYTES. */
  base64?: string;
  size: number;
  skipped?: string;
}

export interface ExportItem extends SearchHit {
  app: string;
  /** Everything else worth keeping: folder, subject, headers, status, thread, etc. */
  metadata: Record<string, unknown>;
  text?: string;
  html?: string;
  attachments?: ExportAttachment[];
}

export interface Hold {
  id: string;
  name: string;
  /** Lower-case emails. */
  custodians: string[];
  /** Apps the hold covers; empty = every app. */
  apps: string[];
}

export interface RetentionRule {
  id: string;
  app: string;
  /** Empty = every kind in the app. */
  kind?: Kind;
  /** Delete content older than this. */
  days: number;
}

export interface Policy {
  holds: Hold[];
  retention: RetentionRule[];
  /** The suite's sensitivity labels; missing from an older Admin center. */
  labels?: LabelSettings;
  /** Data loss prevention rules; missing from an older Admin center. */
  dlp?: DlpSettings;
  /** ISO timestamp of the last change in the Admin center. */
  updatedAt: string;
}

export const MAX_PAGE = 200;
export const MAX_EXPORT_IDS = 100;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
