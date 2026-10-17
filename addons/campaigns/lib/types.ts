// Shapes and choice lists shared by the server and the browser.

export const ROLES = ["admin", "marketer", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export type Ctx = { email: string; name: string; role: Role };
export type Member = { email: string; name: string; role: Role; lastSeen: string };

export const SUB_STATUSES = ["pending", "subscribed", "unsubscribed", "cleaned"] as const;
export type SubStatus = (typeof SUB_STATUSES)[number];

export const CAMPAIGN_STATUSES = ["draft", "scheduled", "sending", "paused", "sent", "canceled"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const SOURCE_KINDS = ["crm_contacts", "crm_leads", "contacts_group"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export type Block =
  | { type: "heading"; text: string; level?: 1 | 2 }
  | { type: "text"; text: string }
  | { type: "button"; text: string; url: string; color?: string }
  | { type: "image"; url: string; alt?: string; link?: string }
  | { type: "divider" }
  | { type: "spacer"; height?: number };
export const BLOCK_TYPES = ["heading", "text", "button", "image", "divider", "spacer"] as const;

export type Settings = {
  fromName: string; fromEmail: string; replyTo: string; orgName: string; postalAddress: string; perMinute: number;
  /** How mail leaves: an outside SMTP server, the suite mail server, or nowhere. */
  sender: { mode: "smtp" | "suite" | "off"; detail: string };
};

export type Audience = {
  id: string; name: string; description: string;
  formEnabled: boolean; doubleOptIn: boolean; formIntro: string;
  counts: { subscribed: number; pending: number; unsubscribed: number; cleaned: number };
  createdAt: string; updatedAt: string; createdBy: string | null;
};

export type Subscriber = {
  id: string; audienceId: string; email: string; firstName: string; lastName: string; company: string;
  fields: Record<string, string>; tags: string[]; status: SubStatus; source: string; sourceRef: string;
  suppressed: string | null; consentAt: string | null; createdAt: string; updatedAt: string;
};

export type AudienceSource = {
  id: string; audienceId: string; kind: SourceKind; params: Record<string, string>; label: string;
  owner: string; lastSyncAt: string | null; lastResult: string;
};

export const SEGMENT_FIELDS = ["email", "first_name", "last_name", "company", "tag", "source", "created", "opened", "clicked", "field"] as const;
export type SegmentField = (typeof SEGMENT_FIELDS)[number];
export const SEGMENT_OPS = ["is", "is_not", "contains", "not_contains", "before", "after", "any", "none", "within_days"] as const;
export type SegmentOp = (typeof SEGMENT_OPS)[number];
export type Condition = { field: SegmentField; op: SegmentOp; value: string; key?: string };
export type Rules = { match: "all" | "any"; conditions: Condition[] };
export type Segment = { id: string; audienceId: string; name: string; rules: Rules; count?: number; updatedAt: string };

export type Template = { id: string; name: string; subject: string; preheader: string; blocks: Block[]; updatedAt: string; createdBy: string | null };

export type Stats = {
  recipients: number; queued: number; sent: number; failed: number; bounced: number; skipped: number;
  opens: number; uniqueOpens: number; clicks: number; uniqueClicks: number; unsubscribes: number; complaints: number;
};

export type Campaign = {
  id: string; name: string; audienceId: string | null; audienceName: string | null;
  segmentId: string | null; segmentName: string | null;
  subject: string; preheader: string; fromName: string; replyTo: string; blocks: Block[];
  status: CampaignStatus; scheduledAt: string | null; startedAt: string | null; finishedAt: string | null;
  recipients: number; createdAt: string; updatedAt: string; createdBy: string | null;
  stats?: Stats;
};

export type Automation = {
  id: string; name: string; audienceId: string; audienceName: string | null;
  trigger: "subscribed" | "tagged"; tag: string; delayMinutes: number;
  subject: string; preheader: string; blocks: Block[]; active: boolean;
  sent: number; waiting: number; updatedAt: string;
};

export const LABELS: Record<string, string> = {
  admin: "Admin", marketer: "Marketer", viewer: "Viewer",
  pending: "Pending", subscribed: "Subscribed", unsubscribed: "Unsubscribed", cleaned: "Cleaned",
  queued: "Queued", failed: "Failed", bounced: "Bounced", skipped: "Skipped",
  draft: "Draft", scheduled: "Scheduled", sending: "Sending", paused: "Paused", sent: "Sent", canceled: "Canceled",
  crm_contacts: "CRM contacts", crm_leads: "CRM leads", contacts_group: "Contacts group",
  manual: "Added by hand", csv: "CSV import", crm_contact: "CRM contact", crm_lead: "CRM lead", contacts: "Contacts", form: "Signup form",
};

export function label(v: string): string {
  return LABELS[v] ?? v;
}
